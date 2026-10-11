Page({
  data: {
    id: '',
    album: null,
    photos: [],
    photosHasMore: false,
    loadingMore: false,
    photosSkip: 0,
    selecting: false,
    selectedPhotoIds: [],
    downloadOriginal: false,
    uploadProgressItems: [],
    uploadProgressExpanded: false,
    uploadInProgress: false
  },

  onLoad(options) {
    this._uploadQueue = []
    this._uploadWorkerRunning = false
    this._choosingUpload = false
    this._nextUploadId = 0
    this._nextPhotoNumber = Number(wx.getStorageSync(this.getUploadSequenceStorageKey(options.id))) || 0
    this.setData({ id: options.id })
    this.restoreUploadState(options.id)
    this.loadDetail()
  },

  onPullDownRefresh() {
    this.loadDetail().finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    this.loadMorePhotos()
  },

  async loadDetail() {
    wx.showLoading({ title: '\u52a0\u8f7d\u4e2d' })
    try {
      const res = await wx.cloud.callFunction({ name: 'getAlbumDetail', data: { albumId: this.data.id, skip: 0 } })
      wx.hideLoading()
      const photos = res.result.photos || []
      const album = { ...res.result.album, createdAtText: this.formatDate(res.result.album && res.result.album.createdAt) }
      this.setData({ album, photos, photosSkip: photos.length, photosHasMore: Boolean(res.result.hasMore), loadingMore: false, selecting: false, selectedPhotoIds: [] })
      if (this._uploadQueue && this._uploadQueue.length) this.processUploadQueue()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '\u52a0\u8f7d\u5931\u8d25', icon: 'none' })
    }
  },

  async loadMorePhotos() {
    if (this.data.loadingMore || !this.data.photosHasMore) return
    this.setData({ loadingMore: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'getAlbumDetail', data: { albumId: this.data.id, skip: this.data.photosSkip } })
      const photos = res.result.photos || []
      this.setData({
        photos: this.data.photos.concat(photos),
        photosSkip: this.data.photosSkip + photos.length,
        photosHasMore: Boolean(res.result.hasMore),
        loadingMore: false
      })
    } catch (err) {
      this.setData({ loadingMore: false })
      wx.showToast({ title: '更多照片加载失败', icon: 'none' })
    }
  },

  async withTempUrls(photos) {
    const fileList = [...new Set(photos.map(photo => photo.fileId).filter(Boolean))]
    if (!fileList.length) return photos
    const urlMap = {}
    // 云开发接口限制单次最多 50 个文件，按批次请求避免整批失败。
    for (let start = 0; start < fileList.length; start += 50) {
      try {
        const res = await wx.cloud.getTempFileURL({ fileList: fileList.slice(start, start + 50) })
        ;(res.fileList || []).forEach(file => {
          urlMap[file.fileID] = file.tempFileURL || ''
        })
      } catch (err) {
      }
    }
    return photos.map(photo => ({
      ...photo,
      displayUrl: urlMap[photo.fileId] || (/^https?:\/\//.test(String(photo.displayUrl || '')) ? photo.displayUrl : ''),
      imageFailed: Boolean(photo.fileId && !urlMap[photo.fileId] && !/^https?:\/\//.test(String(photo.displayUrl || '')))
    }))
  },

  deleteAlbum() {
    wx.showModal({
      title: '\u5220\u9664\u8fd9\u4e2a\u76f8\u518c\uff1f',
      content: '\u5220\u9664\u540e\uff0c\u76f8\u518c\u548c\u91cc\u9762\u7684\u7167\u7247\u90fd\u4f1a\u4ece\u8fd9\u91cc\u79fb\u9664\u3002',
      confirmText: '\u5220\u9664',
      confirmColor: '#ff6f85',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '\u5220\u9664\u4e2d' })
        try {
          await wx.cloud.callFunction({ name: 'deleteAlbum', data: { albumId: this.data.id } })
          wx.hideLoading()
          wx.showToast({ title: '\u5df2\u5220\u9664', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 350)
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '\u5220\u9664\u5931\u8d25', icon: 'none' })
        }
      }
    })
  },

  async getImageContentType(path) {
    try {
      const info = await wx.getImageInfo({ src: path })
      const type = String(info.type || '').toLowerCase()
      if (['jpeg', 'jpg', 'png', 'webp', 'gif'].includes(type)) return type === 'jpg' ? 'image/jpeg' : 'image/' + type
    } catch (err) {
    }
    return 'image/jpeg'
  },

  async prepareImageForSafetyCheck(file) {
    const path = file.tempFilePath
    const originalInfo = await wx.getFileInfo({ filePath: path })
    const originalContentType = await this.getImageContentType(path)
    if (originalInfo.size <= 900 * 1024) {
      return { filePath: path, contentType: originalContentType, isTemporaryCopy: false }
    }

    // imgSecCheck 限制图片大小；审核副本压到 900KB 内，云端仍保存未压缩的原图。
    for (const quality of [70, 50, 30, 10]) {
      try {
        const compressed = await wx.compressImage({ src: path, quality })
        const compressedInfo = await wx.getFileInfo({ filePath: compressed.tempFilePath })
        if (compressedInfo.size <= 900 * 1024) {
          return {
            filePath: compressed.tempFilePath,
            contentType: await this.getImageContentType(compressed.tempFilePath),
            isTemporaryCopy: true
          }
        }
      } catch (err) {
        // 例如 PNG/WebP 不支持质量压缩时，继续尝试画布缩放并转 JPEG。
      }
    }
    return this.createResizedSafetyImage(path)
  },

  async createResizedSafetyImage(path) {
    const info = await wx.getImageInfo({ src: path })
    const scale = Math.min(750 / info.width, 1334 / info.height, 1)
    const width = Math.max(1, Math.round(info.width * scale))
    const height = Math.max(1, Math.round(info.height * scale))

    for (const factor of [1, 0.75, 0.5]) {
      const outputWidth = Math.max(1, Math.round(width * factor))
      const outputHeight = Math.max(1, Math.round(height * factor))
      for (const quality of [0.75, 0.55, 0.35]) {
      const compressed = await new Promise((resolve, reject) => {
        const context = wx.createCanvasContext('safety-check-canvas', this)
        context.clearRect(0, 0, 750, 1334)
        context.drawImage(path, 0, 0, width, height)
        context.draw(false, () => {
          wx.canvasToTempFilePath({
            canvasId: 'safety-check-canvas',
            x: 0,
            y: 0,
            width,
            height,
            destWidth: outputWidth,
            destHeight: outputHeight,
            fileType: 'jpg',
            quality,
            success: resolve,
            fail: reject
          }, this)
        })
      })
      const fileInfo = await wx.getFileInfo({ filePath: compressed.tempFilePath })
      if (fileInfo.size <= 900 * 1024) {
        return { filePath: compressed.tempFilePath, contentType: 'image/jpeg', isTemporaryCopy: true }
      }
      }
    }
    throw new Error('原图过大，无法生成符合审核要求的压缩副本')
  },

  async chooseAndUpload() {
    if (this._choosingUpload) return
    this._choosingUpload = true
    try {
      // Let the user choose either the original or compressed media variant.
      const choose = await wx.chooseMedia({ count: 20, mediaType: ['mix'], sourceType: ['album', 'camera'], sizeType: ['original', 'compressed'] })
      const files = choose.tempFiles || []
      if (!files.length) return
      const tasks = files.map(file => {
        this._nextUploadId += 1
        this._nextPhotoNumber += 1
        const originalName = file.originalName || file.name
        return {
          id: Date.now() + '-' + this._nextUploadId,
          file,
          name: originalName ? originalName + ' · ' + this._nextPhotoNumber : '照片 ' + this._nextPhotoNumber
        }
      })
      wx.setStorageSync(this.getUploadSequenceStorageKey(), this._nextPhotoNumber)
      this._uploadQueue = (this._uploadQueue || []).concat(tasks)
      this.setData({
        uploadInProgress: true,
        uploadProgressExpanded: false,
        uploadProgressItems: this.data.uploadProgressItems.concat(tasks.map((task, index) => ({
          id: task.id,
          name: task.name,
          percent: 0,
          status: '等待上传'
        })))
      })
      this.persistUploadState(true)
      this.processUploadQueue()
    } catch (err) {
      if (!(err.errMsg && err.errMsg.includes('cancel'))) {
        console.error('相册照片上传失败', err)
        wx.showToast({ title: this.getPhotoUploadErrorTitle(err), icon: 'none', duration: 3500 })
      }
    } finally {
      this._choosingUpload = false
    }
  },

  async processUploadQueue() {
    if (this._uploadWorkerRunning) return
    this._uploadWorkerRunning = true
    let successCount = 0
    this.setData({ uploadInProgress: true })
    this.persistUploadState(true)
    while (this._uploadQueue && this._uploadQueue.length) {
      const task = this._uploadQueue.shift()
      this._activeUploadTask = task
      this.persistUploadState(true)
      try {
        await this.uploadOnePhoto(task)
        this._activeUploadTask = null
        this.removeUploadProgress(task.id)
        successCount += 1
      } catch (err) {
        this._activeUploadTask = null
        this.updateUploadProgress(task.id, this.getUploadProgress(task.id), '上传失败')
        this.persistUploadState(true)
        if (!(err.errMsg && err.errMsg.includes('cancel'))) {
          console.error('相册照片上传失败', err)
          wx.showToast({ title: this.getPhotoUploadErrorTitle(err), icon: 'none', duration: 3500 })
        }
      }
    }
    this._uploadWorkerRunning = false
    this.setData({ uploadInProgress: false })
    this.persistUploadState(true)
    if (successCount) {
      wx.showToast({ title: '已上传 ' + successCount + ' 个媒体', icon: 'success' })
      this.loadDetail()
    }
  },

  async uploadOnePhoto(task) {
    const file = task.file
    const mediaType = file.fileType === 'video' || Number(file.duration) > 0 ? 'video' : 'image'
    this.updateUploadProgress(task.id, 2, '准备图片')
    const originalContentType = mediaType === 'image' ? await this.getImageContentType(file.tempFilePath) : ''
    const reviewImage = mediaType === 'image' ? await this.prepareImageForSafetyCheck(file) : null
    // Upload the file returned by the picker as-is so an “原图” choice remains original.
    const uploadPath = file.tempFilePath
    this.updateUploadProgress(task.id, 4, '正在上传')
    const extMatch = String(uploadPath || '').match(/\.([a-z\d]+)(?:\?|$)/i)
    const originalExtMatch = String(file.tempFilePath || '').match(/\.([a-z\d]+)(?:\?|$)/i)
    const ext = mediaType === 'video' ? ((extMatch && extMatch[1].toLowerCase()) || (originalExtMatch && originalExtMatch[1].toLowerCase()) || 'mp4') : (originalContentType === 'image/gif' ? 'gif' : originalContentType === 'image/png' ? 'png' : originalContentType === 'image/webp' ? 'webp' : 'jpg')
    const cloudPath = 'album-photos/' + this.data.id + '/' + Date.now() + '-' + task.id + '-' + Math.floor(Math.random() * 100000) + '.' + ext
    const upload = await this.uploadFileWithProgress({ cloudPath, filePath: uploadPath }, task.id, 4, 82)
    let checkFileId = upload.fileID
    if (mediaType === 'image' && reviewImage.isTemporaryCopy) {
      const suffix = reviewImage.contentType === 'image/png' ? '.png' : (reviewImage.contentType === 'image/webp' ? '.webp' : '.jpg')
      this.updateUploadProgress(task.id, 84, '正在上传审核图片')
      const checkUpload = await this.uploadFileWithProgress({
        cloudPath: 'album-photos-check/' + this.data.id + '/' + Date.now() + '-' + task.id + '-' + Math.floor(Math.random() * 100000) + suffix,
        filePath: reviewImage.filePath
      }, task.id, 84, 94)
      checkFileId = checkUpload.fileID
    }
    let thumbnailFileId = ''
    if (mediaType === 'video' && file.thumbTempFilePath) {
      try {
        const thumb = await wx.cloud.uploadFile({ cloudPath: 'album-photos/' + this.data.id + '/thumb-' + task.id + '.jpg', filePath: file.thumbTempFilePath })
        thumbnailFileId = thumb.fileID
      } catch (err) {
        console.warn('视频封面上传失败', err)
      }
    }
    this.updateUploadProgress(task.id, 96, mediaType === 'video' ? '正在保存视频' : '正在审核并保存')
    await wx.cloud.callFunction({
      name: 'uploadAlbumPhoto',
      data: { albumId: this.data.id, fileId: upload.fileID, mediaType, thumbnailFileId, contentType: mediaType === 'video' ? ('video/' + (ext === 'mov' ? 'quicktime' : ext)) : originalContentType, checkFileId, checkContentType: mediaType === 'video' ? '' : reviewImage.contentType }
    })
    this.removeUploadProgress(task.id)
  },

  getUploadProgress(id) {
    const item = this.data.uploadProgressItems.find(progress => progress.id === id)
    return item ? item.percent : 0
  },

  updateUploadProgress(id, percent, status) {
    const items = this.data.uploadProgressItems.slice()
    const index = items.findIndex(item => item.id === id)
    if (index < 0) return
    const previous = items[index]
    const nextPercent = Math.max(previous.percent, percent)
    items[index] = { ...previous, percent: nextPercent, status }
    this.setData({ uploadProgressItems: items })
    const statusChanged = status !== previous.status && !status.startsWith('正在上传')
    if (statusChanged || nextPercent - previous.percent >= 5) this.persistUploadState(true)
  },

  removeUploadProgress(id) {
    this.setData({ uploadProgressItems: this.data.uploadProgressItems.filter(item => item.id !== id) })
    this.persistUploadState(true)
  },

  getUploadStorageKey(id = this.data.id) {
    return 'album_upload_progress_' + id
  },

  getUploadSequenceStorageKey(id = this.data.id) {
    return 'album_upload_sequence_' + id
  },

  serializeUploadTask(task) {
    if (!task) return null
    const file = task.file || {}
    const filePath = task.filePath || file.tempFilePath || ''
    return { id: task.id, filePath, name: task.name || '媒体', fileType: file.fileType || '', duration: Number(file.duration) || 0, thumbTempFilePath: file.thumbTempFilePath || '' }
  },

  persistUploadState() {
    try {
      const queue = (this._uploadQueue || []).map(task => this.serializeUploadTask(task))
      const activeTask = this.serializeUploadTask(this._activeUploadTask)
      const items = this.data.uploadProgressItems || []
      const key = this.getUploadStorageKey()
      if (!items.length && !queue.length && !activeTask) {
        wx.removeStorageSync(key)
        return
      }
      wx.setStorageSync(key, { items, queue, activeTask })
    } catch (err) {
      console.warn('保存相册上传进度失败', err)
    }
  },

  restoreUploadState(albumId) {
    try {
      const saved = wx.getStorageSync(this.getUploadStorageKey(albumId))
      if (!saved) return
      const activeTask = saved.activeTask
      const queue = (activeTask ? [activeTask] : []).concat(saved.queue || []).filter(task => task.filePath)
      const retryIds = new Set(activeTask ? [activeTask.id] : [])
      const items = (saved.items || []).map(item => retryIds.has(item.id)
        ? { ...item, percent: 0, status: '恢复上传中' }
        : item)
      this._uploadQueue = queue.map(task => ({
        id: task.id,
        name: task.name,
        file: { tempFilePath: task.filePath, originalName: task.name, fileType: task.fileType || '', duration: task.duration || 0, thumbTempFilePath: task.thumbTempFilePath || '' }
      }))
      this.setData({ uploadProgressItems: items, uploadInProgress: this._uploadQueue.length > 0 })
    } catch (err) {
      console.warn('恢复相册上传进度失败', err)
    }
  },

  uploadFileWithProgress(options, id, startPercent, endPercent) {
    return new Promise((resolve, reject) => {
      const task = wx.cloud.uploadFile(options)
      if (task && typeof task.onProgressUpdate === 'function') {
        task.onProgressUpdate(progress => {
          const percent = startPercent + (endPercent - startPercent) * (Number(progress.progress) || 0) / 100
          this.updateUploadProgress(id, Math.floor(percent), '正在上传 ' + (Number(progress.progress) || 0) + '%')
        })
      }
      task.then(resolve, reject)
    })
  },

  toggleUploadProgress() {
    this.setData({ uploadProgressExpanded: !this.data.uploadProgressExpanded })
  },

  dismissUploadProgress() {
    if (this.data.uploadInProgress) return
    this.setData({ uploadProgressItems: [], uploadProgressExpanded: false })
  },

  isUnsafeContentError(err) {
    return /CONTENT_UNSAFE/.test(String((err && (err.errMsg || err.message)) || ''))
  },

  getPhotoUploadErrorTitle(err) {
    const message = String((err && (err.errMsg || err.message)) || '')
    if (/原图过大/.test(message)) return '原图过大，审核压缩失败'
    if (this.isUnsafeContentError(err)) return '内容含违规信息'
    if (this.isContentCheckPermissionError(err)) return '审核权限未生效，请重新部署上传云函数'
    if (this.isContentCheckError(err)) return '内容检测暂不可用'
    return '上传失败'
  },

  isContentCheckError(err) {
    return /CONTENT_CHECK_FAILED/.test(String((err && (err.errMsg || err.message)) || ''))
  },

  isContentCheckPermissionError(err) {
    return /-604101/.test(String((err && (err.errMsg || err.message)) || ''))
  },

  formatDate(value) {
    const raw = value && (value.$date || value.date || value)
    const date = raw instanceof Date ? raw : new Date(raw)
    if (Number.isNaN(date.getTime())) return '—'
    const pad = number => String(number).padStart(2, '0')
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
  },

  toggleSelecting() {
    const selecting = !this.data.selecting
    this.setData({ selecting, selectedPhotoIds: [], downloadOriginal: false, photos: this.data.photos.map(photo => ({ ...photo, selected: false })) })
  },

  togglePhotoSelection(e) {
    if (!this.data.selecting) return
    const photoId = e.currentTarget.dataset.id
    const selectedPhotoIds = this.data.selectedPhotoIds.slice()
    const index = selectedPhotoIds.indexOf(photoId)
    if (index >= 0) selectedPhotoIds.splice(index, 1)
    else selectedPhotoIds.push(photoId)
    this.setData({ selectedPhotoIds, photos: this.data.photos.map(photo => ({ ...photo, selected: selectedPhotoIds.includes(photo._id) })) })
  },

  toggleSelectAll() {
    const shouldClear = this.data.photos.length > 0 && this.data.selectedPhotoIds.length === this.data.photos.length
    const selectedPhotoIds = shouldClear ? [] : this.data.photos.map(photo => photo._id)
    this.setData({
      selectedPhotoIds,
      photos: this.data.photos.map(photo => ({ ...photo, selected: selectedPhotoIds.includes(photo._id) }))
    })
  },

  getSelectedPhotos() {
    return this.data.photos.filter(photo => this.data.selectedPhotoIds.includes(photo._id))
  },

  onDownloadOriginalChange(e) {
    this.setData({ downloadOriginal: (e.detail.value || []).includes('original') })
  },

  confirmBatchDelete() {
    const photos = this.getSelectedPhotos()
    if (!photos.length) return wx.showToast({ title: '请先选择照片', icon: 'none' })
    wx.showModal({ title: '删除选中的媒体？', content: '将删除 ' + photos.length + ' 个媒体，此操作无法撤销。', confirmText: '删除', confirmColor: '#ff6f85', success: res => { if (res.confirm) this.batchDeletePhotos(photos) } })
  },

  async batchDeletePhotos(photos) {
    let success = 0
    for (let index = 0; index < photos.length; index += 1) {
      wx.showLoading({ title: '删除中 ' + (index + 1) + '/' + photos.length, mask: true })
      try {
        await wx.cloud.callFunction({ name: 'deleteAlbumPhoto', data: { photoId: photos[index]._id } })
        success += 1
      } catch (err) {
      }
    }
    wx.hideLoading()
    wx.showToast({ title: '已删除 ' + success + ' 个', icon: success ? 'success' : 'none' })
    this.loadDetail()
  },

  confirmBatchDownload() {
    const photos = this.getSelectedPhotos()
    if (!photos.length) return wx.showToast({ title: '请先选择照片', icon: 'none' })
    this.batchDownloadPhotos(photos, this.data.downloadOriginal)
  },

  async getSavableImagePath(photo, original) {
    let source = ''
    if (original) {
      const file = await wx.cloud.downloadFile({ fileID: photo.fileId })
      source = file.tempFilePath || ''
    } else {
      source = photo.originalDisplayUrl || photo.displayUrl || ''
      if (!source) {
        const res = await wx.cloud.getTempFileURL({ fileList: [photo.fileId] })
        source = (res.fileList || [])[0] && (res.fileList || [])[0].tempFileURL
      }
    }
    if (!source) throw new Error('图片地址不可用')
    if (photo.mediaType === 'video') {
      if (!/^https?:\/\//.test(source)) return source
      const file = await wx.downloadFile({ url: source })
      if (file.statusCode !== 200 || !file.tempFilePath) throw new Error('视频下载失败')
      return file.tempFilePath
    }
    try {
      const imageInfo = await wx.getImageInfo({ src: source })
      return imageInfo.path || source
    } catch (imageInfoError) {
      if (!/^https?:\/\//.test(source)) return source
      const file = await wx.downloadFile({ url: source })
      if (file.statusCode !== 200 || !file.tempFilePath) throw imageInfoError
      return file.tempFilePath
    }
  },

  async batchDownloadPhotos(photos, original) {
    let success = 0
    let lastError = null
    for (let index = 0; index < photos.length; index += 1) {
      wx.showLoading({ title: '下载中 ' + (index + 1) + '/' + photos.length, mask: true })
      try {
        const photo = photos[index]
        const filePath = await this.getSavableImagePath(photo, original)
        if (photos[index].mediaType === 'video') await wx.saveVideoToPhotosAlbum({ filePath })
        else await wx.saveImageToPhotosAlbum({ filePath })
        success += 1
      } catch (err) {
        console.error('照片保存失败', err)
        lastError = err
      }
    }
    wx.hideLoading()
    if (success) {
      wx.showToast({ title: '已保存 ' + success + ' 个', icon: 'success' })
    } else if (lastError && /api scope is not declared in the privacy agreement|errno:\s*112/i.test(lastError.errMsg || '')) {
      wx.showModal({
        title: '需配置隐私声明',
        content: '当前小程序尚未在微信公众平台声明“保存图片到系统相册”。请由管理员完成声明并提交后再试。',
        confirmText: '知道了',
        confirmColor: '#ff6f85',
        showCancel: false
      })
    } else if (lastError && /auth|permission|deny/i.test(lastError.errMsg || '')) {
      wx.showModal({
        title: '请允许保存到相册',
        content: '请在微信设置中允许保存图片后再试。',
        confirmText: '去设置',
        confirmColor: '#ff6f85',
        success: res => { if (res.confirm) wx.openSetting() }
      })
    } else {
      const message = (lastError && lastError.errMsg) || ''
      wx.showToast({ title: /download|getImageInfo|network/i.test(message) ? '图片下载失败，请重试' : '图片保存失败，请重试', icon: 'none' })
    }
  },

  onImageError(e) {
    const photoId = e.currentTarget.dataset.id
    const photo = this.data.photos.find(item => item._id === photoId)
    if (!photo) return
    if (photo.originalDisplayUrl && photo.displayUrl !== photo.originalDisplayUrl) {
      this.setData({
        photos: this.data.photos.map(item => item._id === photoId
          ? { ...item, displayUrl: item.originalDisplayUrl }
          : item)
      })
      return
    }
    this.setData({
      photos: this.data.photos.map(item => item._id === photoId
        ? { ...item, displayUrl: '', imageFailed: true }
        : item)
    })
  },

  preview(e) {
    if (this.data.selecting) return
    const currentId = e.currentTarget.dataset.id
    const selected = this.data.photos.find(photo => photo._id === currentId)
    if (!selected) return
    const mediaItems = []
    let current = 0
    this.data.photos.forEach(photo => {
      const isVideo = photo.mediaType === 'video'
      const url = isVideo
        ? (photo.originalDisplayUrl || photo.fileId || '')
        : (photo.originalDisplayUrl || photo.displayUrl || '')
      if (!url) return
      if (photo._id === currentId) current = mediaItems.length
      mediaItems.push({
        src: url,
        type: isVideo ? 'video' : 'image',
        poster: isVideo ? (photo.thumbnailUrl || photo.displayUrl || '') : '',
        id: photo._id
      })
    })
    if (!mediaItems.length) return
    const photoCount = Number(this.data.album && this.data.album.photoCount) || 0
    getApp().globalData.previewMediaState = {
      mediaItems,
      currentIndex: current,
      totalCount: Math.max(photoCount, mediaItems.length, this.data.photosHasMore ? mediaItems.length + 1 : 0),
      hasMore: this.data.photosHasMore,
      skip: this.data.photosSkip,
      collectionType: 'album',
      collectionId: this.data.id
    }
    wx.navigateTo({
      url: '/pages/video-player/index',
      fail: () => wx.showToast({ title: '媒体预览打开失败，请重试', icon: 'none' })
    })
  }
})
