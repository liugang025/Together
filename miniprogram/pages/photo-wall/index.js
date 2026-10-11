// 临时图片链接会过期，升级缓存版本，避免继续使用旧的失效封面。
// 临时图片链接会过期，升级缓存版本，避免使用旧地址。
const PHOTO_CACHE_KEY = 'daily_photo_wall_cache_v8'
const PHOTO_CACHE_MAX_AGE = 60 * 60 * 1000

function makeThumbnailUrl(url) {
  if (!url) return ''
  const separator = url.includes('?') ? '&' : '?'
  return url + separator + 'imageMogr2/thumbnail/400x/quality/72/format/webp'
}

Page({
  data: {
    photos: [],
    todoAlbums: [],
    albums: []
  },

  onShow() {
    this.setTabBarSelected()
    this.applyCachedData()
    this.loadData({ silent: true })
  },

  setTabBarSelected() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
  },

  applyCachedData() {
    try {
      const cache = wx.getStorageSync(PHOTO_CACHE_KEY) || null
      if (!cache) return
      if (!cache.updatedAt || Date.now() - cache.updatedAt > PHOTO_CACHE_MAX_AGE) {
        wx.removeStorageSync(PHOTO_CACHE_KEY)
        return
      }
      this.setData({
        photos: cache.photos || [],
        todoAlbums: cache.todoAlbums || [],
        albums: cache.albums || []
      })
    } catch (err) {
    }
  },

  async loadData(options = {}) {
    const shouldShowLoading = !options.silent && !this.data.photos.length && !this.data.albums.length
    if (shouldShowLoading) wx.showLoading({ title: '\u52a0\u8f7d\u4e2d' })
    try {
      const [photoResult, albumResult] = await Promise.allSettled([
        wx.cloud.callFunction({ name: 'getPhotoWall' }),
        wx.cloud.callFunction({ name: 'getAlbums' })
      ])

      let photos = this.data.photos
      let todoAlbums = this.data.todoAlbums
      let albums = this.data.albums

      if (photoResult.status === 'fulfilled') {
        const result = (photoResult.value && photoResult.value.result) || {}
        photos = result.photos || []
        const serverTodoAlbums = result.todoAlbums || []
        // 首次显示前在客户端刷新候选封面的临时链接，避免服务端某批链接为空时直接显示不可用。
        todoAlbums = serverTodoAlbums.length
          ? await this.withTempUrls(serverTodoAlbums, 'coverFileIds', 'coverUrl')
          : await this.withTempUrls(this.groupTodoAlbums(photos), 'coverFileIds', 'coverUrl')
      } else {
        wx.showToast({ title: '照片读取失败，请稍后重试', icon: 'none' })
      }

      if (albumResult.status === 'fulfilled') {
        const remoteAlbums = (albumResult.value.result && albumResult.value.result.albums) || []
        albums = await this.withTempUrls(remoteAlbums, 'coverFileIds', 'coverUrl')
      }

      this.setData({ photos, todoAlbums, albums })
      wx.setStorageSync(PHOTO_CACHE_KEY, { photos, todoAlbums, albums, updatedAt: Date.now() })
    } catch (err) {
      if (!options.silent || (!this.data.photos.length && !this.data.albums.length)) {
        wx.showToast({ title: '\u52a0\u8f7d\u5931\u8d25', icon: 'none' })
      }
    } finally {
      if (shouldShowLoading) wx.hideLoading()
    }
  },

  async withTempUrls(items, fileKey, urlKey) {
    const fileIds = [...new Set(items.flatMap(item => {
      const existing = item.originalCoverUrl || item[urlKey] || ''
      if (/^https?:\/\//.test(String(existing))) return []
      const ids = item[fileKey] || item.coverFileId || ''
      return Array.isArray(ids) ? ids : [ids]
    }).filter(Boolean))]
    const pathMap = {}
    // getTempFileURL 每次最多 50 个文件，超过限制会使整批请求失败。
    for (let start = 0; start < fileIds.length; start += 50) {
      try {
        const res = await wx.cloud.getTempFileURL({ fileList: fileIds.slice(start, start + 50) })
        ;(res.fileList || []).forEach(file => {
          pathMap[file.fileID] = file.tempFileURL || ''
        })
      } catch (err) {
        console.warn('图片临时链接获取失败', start, err)
      }
    }
    return items.map(item => ({
      ...item,
      // 相册封面可能已失效，候选列表中任意一张可用照片都可作为封面。
      // 事项照片是单个 fileId，因此同一逻辑也适用。
      ...(() => {
        const ids = item[fileKey] || item.coverFileId || ''
        const candidates = Array.isArray(ids) ? ids : [ids]
        const activeFileId = candidates.find(fileId => pathMap[fileId]) || ''
        const refreshedUrl = pathMap[activeFileId] || ''
        // 云函数返回的 HTTPS 临时链接仍在有效期内时可直接使用；
        // 不能因为本次刷新漏掉某个文件就把已有可用链接覆盖为空。
        const existingUrl = /^https?:\/\//.test(String(item.originalCoverUrl || item[urlKey] || ''))
          ? (item.originalCoverUrl || item[urlKey])
          : ''
        const originalCoverUrl = refreshedUrl || existingUrl
        const url = makeThumbnailUrl(originalCoverUrl)
        return { [urlKey]: url, originalCoverUrl, activeFileId: activeFileId || item.activeFileId || '', imageFailed: Boolean(candidates.filter(Boolean).length && !originalCoverUrl) }
      })()
    }))
  },

  groupTodoAlbums(photos) {
    const albumMap = {}
    photos.forEach(photo => {
      const todoId = photo.todoId || ''
      if (!todoId) return
      if (!albumMap[todoId]) {
        albumMap[todoId] = {
          todoId,
          title: photo.todoTitle || '\u672a\u547d\u540d\u4e8b\u9879',
          coverUrl: photo.displayUrl || '',
          coverFileIds: [],
          count: 0,
          photos: []
        }
      }
      albumMap[todoId].count += 1
      albumMap[todoId].photos.push(photo)
      // 最多保留 3 张封面候选图，首图失效时仍能快速降级到下一张。
      if (photo.fileId && !albumMap[todoId].coverFileIds.includes(photo.fileId) && albumMap[todoId].coverFileIds.length < 3) {
        albumMap[todoId].coverFileIds.push(photo.fileId)
      }
      if (!albumMap[todoId].coverUrl && photo.displayUrl) {
        albumMap[todoId].coverUrl = photo.displayUrl
      }
    })
    return Object.values(albumMap)
  },

  createAlbum() {
    wx.showModal({
      title: '\u65b0\u5efa\u76f8\u518c',
      editable: true,
      placeholderText: '\u8f93\u5165\u76f8\u518c\u540d\u79f0',
      confirmText: '\u521b\u5efa',
      confirmColor: '#ff6f85',
      success: async (res) => {
        if (!res.confirm) return
        const name = (res.content || '').trim()
        if (!name) {
          wx.showToast({ title: '\u76f8\u518c\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a', icon: 'none' })
          return
        }
        wx.showLoading({ title: '\u521b\u5efa\u4e2d' })
        try {
          const addRes = await wx.cloud.callFunction({ name: 'createAlbum', data: { name } })
          wx.hideLoading()
          wx.showToast({ title: '\u5df2\u521b\u5efa', icon: 'success' })
          wx.removeStorageSync(PHOTO_CACHE_KEY)
          wx.navigateTo({ url: '/pages/album-detail/index?id=' + addRes.result.albumId })
        } catch (err) {
          wx.hideLoading()
          const message = (err && (err.errMsg || err.message)) || ''
          const title = message.includes('createAlbum') || message.includes('not found') || message.includes('FUNCTION')
            ? 'createAlbum\u672a\u90e8\u7f72'
            : (message.includes('\u672a\u7ed1\u5b9a') ? '\u8bf7\u5148\u7ed1\u5b9a\u4e24\u4eba\u7a7a\u95f4' : '\u521b\u5efa\u76f8\u518c\u5931\u8d25')
          wx.showModal({ title, content: message || '\u8bf7\u67e5\u770b\u63a7\u5236\u53f0\u9519\u8bef\u4fe1\u606f', showCancel: false })
        }
      }
    })
  },

  deleteAlbum(e) {
    const albumId = e.currentTarget.dataset.id
    wx.showModal({
      title: '\u5220\u9664\u8fd9\u4e2a\u76f8\u518c\uff1f',
      content: '\u5220\u9664\u540e\uff0c\u76f8\u518c\u548c\u91cc\u9762\u7684\u7167\u7247\u90fd\u4f1a\u4ece\u8fd9\u91cc\u79fb\u9664\u3002',
      confirmText: '\u5220\u9664',
      confirmColor: '#ff6f85',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '\u5220\u9664\u4e2d' })
        try {
          await wx.cloud.callFunction({ name: 'deleteAlbum', data: { albumId } })
          wx.hideLoading()
          wx.showToast({ title: '\u5df2\u5220\u9664', icon: 'success' })
          wx.removeStorageSync(PHOTO_CACHE_KEY)
          this.loadData()
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '\u5220\u9664\u5931\u8d25', icon: 'none' })
        }
      }
    })
  },

  openAlbum(e) {
    wx.navigateTo({ url: '/pages/album-detail/index?id=' + e.currentTarget.dataset.id })
  },

  async onImageError(e) {
    const field = e.currentTarget.dataset.field
    const id = e.currentTarget.dataset.id
    const list = field === 'album' ? this.data.albums : this.data.todoAlbums
    const key = field === 'album' ? '_id' : 'todoId'
    const prefix = field === 'album' ? 'albums' : 'todoAlbums'
    const index = list.findIndex(item => item[key] === id)
    if (index < 0) return

    const current = list[index]
    // 缓存图可能在新链接刷新后才触发 error；不要让旧请求清空刚更新的封面。
    const failedUrl = e.currentTarget.dataset.url || ''
    if (failedUrl && current.coverUrl !== failedUrl) return

    // 如果只失败了缩略图处理请求，先显示同一文件的原图，再尝试替换候选照片。
    if (current.originalCoverUrl && current.coverUrl !== current.originalCoverUrl) {
      this.setData({ [prefix + '[' + index + '].coverUrl']: current.originalCoverUrl })
      return
    }

    // 先为当前封面重新申请临时链接，再尝试同相册的其他照片。
    if (current.activeFileId) {
      const [refreshed] = await this.withTempUrls([
        { ...current, coverFileIds: [current.activeFileId], coverUrl: '', originalCoverUrl: '' }
      ], 'coverFileIds', 'coverUrl')
      if (refreshed && refreshed.coverUrl && refreshed.coverUrl !== current.coverUrl) {
        this.setData({
          [prefix + '[' + index + '].coverUrl']: refreshed.coverUrl,
          [prefix + '[' + index + '].originalCoverUrl']: refreshed.originalCoverUrl,
          [prefix + '[' + index + '].imageFailed']: false
        })
        return
      }
    }

    const candidates = (current.coverFileIds || []).filter(fileId => fileId && fileId !== current.activeFileId)
    // 当前封面失效时优先尝试同一相册的下一张候选照片。
    if (candidates.length) {
      const [replacement] = await this.withTempUrls([
        { ...current, coverFileIds: candidates, coverUrl: '', originalCoverUrl: '' }
      ], 'coverFileIds', 'coverUrl')
      if (replacement && replacement.coverUrl) {
        this.setData({
          [prefix + '[' + index + '].coverUrl']: replacement.coverUrl,
          [prefix + '[' + index + '].originalCoverUrl']: replacement.originalCoverUrl,
          [prefix + '[' + index + '].activeFileId']: replacement.activeFileId,
          [prefix + '[' + index + '].imageFailed']: false
        })
        return
      }
    }

    // 不再保留失败的 src，避免渲染层不断重复请求同一个无效链接。
    this.setData({
      [prefix + '[' + index + '].coverUrl']: '',
      [prefix + '[' + index + '].imageFailed']: true
    })
  },

  previewTodoPhoto(e) {
    const current = e.currentTarget.dataset.file
    const urls = this.data.photos.map(photo => photo.displayUrl).filter(Boolean)
    if (!current || !urls.length) return
    wx.previewImage({ current, urls })
  },

  openTodoAlbum(e) {
    wx.navigateTo({ url: '/pages/todo-detail/index?id=' + e.currentTarget.dataset.id })
  },

  openTodo(e) {
    wx.navigateTo({ url: '/pages/todo-detail/index?id=' + e.currentTarget.dataset.id })
  }
})
