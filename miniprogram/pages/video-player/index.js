Page({
  data: {
    mediaItems: [],
    currentIndex: 0,
    currentMedia: null,
    carouselVisible: false,
    carouselOffset: 0,
    carouselTransition: 'none',
    totalCount: 0,
    loading: true
  },

  async onLoad(options) {
    const app = getApp()
    const state = app.globalData.previewMediaState || null
    app.globalData.previewMediaState = null
    let mediaItems = state && Array.isArray(state.mediaItems) ? state.mediaItems.slice() : []

    // Keep compatibility with callers that open this page with one video fileId.
    if (!mediaItems.length && options.fileId) {
      let fileId = options.fileId
      let posterFileId = options.posterFileId || ''
      try {
        fileId = decodeURIComponent(fileId)
        posterFileId = decodeURIComponent(posterFileId)
      } catch (err) {
      }
      try {
        const fileIds = posterFileId ? [fileId, posterFileId] : [fileId]
        const result = await wx.cloud.getTempFileURL({ fileList: fileIds })
        const urlMap = {}
        ;(result.fileList || []).forEach(item => { urlMap[item.fileID] = item.tempFileURL || '' })
        if (urlMap[fileId]) {
          mediaItems = [{ src: urlMap[fileId], type: 'video', poster: urlMap[posterFileId] || '' }]
        }
      } catch (err) {
      }
    }

    const currentIndex = Math.max(0, Math.min(
      Number(state && state.currentIndex !== undefined ? state.currentIndex : options.current) || 0,
      mediaItems.length - 1
    ))
    if (!mediaItems.length) {
      this.setData({ loading: false })
      wx.showToast({ title: '媒体地址不可用', icon: 'none' })
      return
    }

    this._collectionType = state && state.collectionType
    this._collectionId = state && state.collectionId
    this._skip = Number(state && state.skip) || mediaItems.length
    this._hasMore = Boolean(state && state.hasMore)
    this._prefetchPromise = null
    this._pendingIndex = null
    const totalCount = Math.max(Number(state && state.totalCount) || 0, mediaItems.length)
    this.setData({ mediaItems, currentIndex, currentMedia: mediaItems[currentIndex], totalCount, loading: true })
    this.updateCounter(currentIndex, totalCount)
    // Prepare the visible item and its neighbors before accepting a swipe. Otherwise
    // the first fast swipe can show an empty carousel overlay while image sizes load.
    await this.prepareCarouselItems(currentIndex)
    this.setData({ loading: false })

    // Open the first item immediately; continue loading the rest in the background.
    this.prefetchRemainingMedia()
  },

  updateCounter(index, total) {
    wx.setNavigationBarTitle({ title: (index + 1) + ' / ' + total })
  },

  async changeMedia(index) {
    if (this.data.loading || this._settling || index < 0 || index >= this.data.mediaItems.length || index === this.data.currentIndex) return
    const direction = index > this.data.currentIndex ? 1 : -1
    this._settling = true
    // Newly paged-in photos may not have carousel dimensions yet. Never animate
    // an empty slot: prepare the destination before putting the carousel on screen.
    await this.prepareCarouselItems(index)
    if (this._unloaded) return
    this.setData({ carouselVisible: true, carouselTransition: 'transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1)', carouselOffset: direction > 0 ? -wx.getWindowInfo().windowWidth : wx.getWindowInfo().windowWidth })
    clearTimeout(this._turnTimer)
    this._turnTimer = setTimeout(() => this.finishCarousel(index), 240)
  },

  finishCarousel(index) {
    if (index < 0 || index >= this.data.mediaItems.length) return
    // Keep the landed carousel card over the stage until the new image/video is
    // actually ready. Removing it in the same setData as changing src can expose
    // one black frame while the native media component is recreated.
    const token = (this._handoffToken || 0) + 1
    this._handoffToken = token
    this._handoffIndex = index
    this._handoffReady = false
    this._handoffPrepPromise = this.prepareCarouselItems(index)
    this._handoffPrepPromise.then(() => {
      if (token === this._handoffToken && this._handoffReady) this.completeStageHandoff(token)
    })
    this.setData({ currentMedia: this.data.mediaItems[index] })
    this.updateCounter(index, this.data.totalCount)
    clearTimeout(this._handoffTimer)
    this._handoffTimer = setTimeout(() => this.completeStageHandoff(token), 1200)
  },

  onStageReady() {
    if (this._handoffIndex === undefined) return
    this._handoffReady = true
    if (!this._handoffPrepPromise) this.completeStageHandoff(this._handoffToken)
    else this._handoffPrepPromise.then(() => this.completeStageHandoff(this._handoffToken))
  },

  completeStageHandoff(token) {
    if (token !== this._handoffToken || this._handoffIndex === undefined) return
    clearTimeout(this._handoffTimer)
    const index = this._handoffIndex
    this._handoffIndex = undefined
    this._handoffReady = false
    this._handoffPrepPromise = null
    this.setData({ currentIndex: index, carouselVisible: false, carouselOffset: 0, carouselTransition: 'none' })
    this._settling = false
  },

  async prepareCarouselItems(index) {
    const itemsAtStart = this.data.mediaItems
    const targets = [index - 1, index, index + 1].filter(i => i >= 0 && i < itemsAtStart.length && !itemsAtStart[i].previewStyle)
    if (!targets.length) return
    const info = wx.getWindowInfo()
    const maxWidth = info.windowWidth
    const maxHeight = info.windowHeight
    const previewStyles = {}
    await Promise.all(targets.map(async i => {
      const media = itemsAtStart[i]
      const src = media.type === 'video' ? media.poster : media.src
      if (!src) return
      try {
        const imageInfo = await wx.getImageInfo({ src })
        const scale = Math.min(maxWidth / imageInfo.width, maxHeight / imageInfo.height)
        previewStyles[i] = `width:${Math.round(imageInfo.width * scale)}px;height:${Math.round(imageInfo.height * scale)}px;`
      } catch (err) {
        // Still render the image using aspectFit if metadata lookup fails.
        previewStyles[i] = 'width:100%;height:100%;'
      }
    }))
    if (!this._unloaded) {
      const latestItems = this.data.mediaItems.slice()
      Object.keys(previewStyles).forEach(key => {
        const i = Number(key)
        if (latestItems[i] && !latestItems[i].previewStyle) latestItems[i] = { ...latestItems[i], previewStyle: previewStyles[i] }
      })
      this.setData({ mediaItems: latestItems })
    }
  },

  previous() {
    this.changeMedia(this.data.currentIndex - 1)
  },

  next() {
    const nextIndex = this.data.currentIndex + 1
    if (nextIndex < this.data.mediaItems.length) {
      this.changeMedia(nextIndex)
      return
    }
    if (nextIndex >= this.data.totalCount || !this._hasMore) return
    this._pendingIndex = nextIndex
    this.prefetchRemainingMedia()
  },

  async prefetchRemainingMedia() {
    if (this._prefetchPromise) return this._prefetchPromise
    if (!this._hasMore || !this._collectionId || !this._collectionType) return

    this._prefetchPromise = (async () => {
      while (this._hasMore) {
        const name = this._collectionType === 'album' ? 'getAlbumDetail' : 'getTodoDetail'
        const idKey = this._collectionType === 'album' ? 'albumId' : 'todoId'
        const res = await wx.cloud.callFunction({
          name,
          data: { [idKey]: this._collectionId, skip: this._skip, pageSize: 100 }
        })
        let photos = (res.result && res.result.photos) || []
        if (this._collectionType === 'todo') photos = await this.attachTempUrls(photos)
        if (!photos.length) {
          this._hasMore = false
          break
        }

        const newItems = photos.map(photo => {
          const isVideo = photo.mediaType === 'video'
          const src = isVideo
            ? (photo.originalDisplayUrl || photo.fileId || '')
            : (photo.originalDisplayUrl || photo.displayUrl || photo.fileId || '')
          return {
            src,
            type: isVideo ? 'video' : 'image',
            poster: isVideo ? (photo.thumbnailUrl || photo.displayUrl || '') : '',
            id: photo._id
          }
        })
        this._skip += photos.length
        this._hasMore = Boolean(res.result && res.result.hasMore)
        const allItems = this.data.mediaItems.concat(newItems)
        const totalCount = Math.max(this.data.totalCount, allItems.length)
        this.setData({ mediaItems: allItems, totalCount })
        await this.prepareCarouselItems(this.data.currentIndex)

        if (this._pendingIndex !== null && this._pendingIndex < allItems.length) {
          const pendingIndex = this._pendingIndex
          this._pendingIndex = null
          this.changeMedia(pendingIndex)
        }
      }
    })()

    try {
      await this._prefetchPromise
    } catch (err) {
      console.warn('预加载后续媒体失败', err)
      this._hasMore = true
      if (this._pendingIndex !== null) {
        this._pendingIndex = null
        wx.showToast({ title: '后续媒体加载失败，请重试', icon: 'none' })
      }
    } finally {
      this._prefetchPromise = null
    }
  },

  async attachTempUrls(photos) {
    const fileIds = [...new Set(photos.flatMap(photo => [photo.fileId, photo.thumbnailFileId]).filter(Boolean))]
    const urlMap = {}
    for (let start = 0; start < fileIds.length; start += 50) {
      const res = await wx.cloud.getTempFileURL({ fileList: fileIds.slice(start, start + 50) })
      ;(res.fileList || []).forEach(file => { urlMap[file.fileID] = file.tempFileURL || '' })
    }
    return photos.map(photo => ({
      ...photo,
      originalDisplayUrl: urlMap[photo.fileId] || '',
      thumbnailUrl: urlMap[photo.thumbnailFileId] || '',
      displayUrl: photo.mediaType === 'video'
        ? (urlMap[photo.thumbnailFileId] || '')
        : (urlMap[photo.fileId] || '')
    }))
  },

  onTouchStart(e) {
    if (this.data.loading || this._settling) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this._touchStart = { x: touch.clientX, y: touch.clientY }
    this._touchMoved = false
  },

  onTouchMove(e) {
    const start = this._touchStart
    const touch = e.touches && e.touches[0]
    if (!start || !touch || this._settling) return
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (!this._touchMoved && (Math.abs(deltaX) < 8 || Math.abs(deltaX) <= Math.abs(deltaY))) return
    this._touchMoved = true
    const atFirst = this.data.currentIndex === 0 && deltaX > 0
    const atLast = this.data.currentIndex + 1 >= this.data.mediaItems.length && !this._hasMore && deltaX < 0
    const offset = atFirst || atLast ? deltaX * 0.28 : deltaX
    this.setData({ carouselVisible: true, carouselTransition: 'none', carouselOffset: offset })
  },

  onTouchEnd(e) {
    const start = this._touchStart
    const touch = e.changedTouches && e.changedTouches[0]
    this._touchStart = null
    if (!start || !touch) return
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (!this._touchMoved) return
    if (Math.abs(deltaX) <= Math.abs(deltaY)) {
      this.setData({ carouselTransition: 'transform 180ms cubic-bezier(0.22, 0.61, 0.36, 1)', carouselOffset: 0 })
      clearTimeout(this._turnTimer)
      this._turnTimer = setTimeout(() => this.setData({ carouselVisible: false, carouselTransition: 'none' }), 200)
      return
    }
    const threshold = Math.min(90, wx.getWindowInfo().windowWidth * 0.22)
    if (deltaX < -threshold && this.data.currentIndex + 1 < this.data.mediaItems.length) {
      this.changeMedia(this.data.currentIndex + 1)
    } else if (deltaX < -threshold && this._hasMore) {
      this.next()
      this.setData({ carouselVisible: false, carouselOffset: 0 })
    } else if (deltaX > threshold && this.data.currentIndex > 0) {
      this.changeMedia(this.data.currentIndex - 1)
    } else {
      this.setData({ carouselTransition: 'transform 180ms cubic-bezier(0.22, 0.61, 0.36, 1)', carouselOffset: 0 })
      clearTimeout(this._turnTimer)
      this._turnTimer = setTimeout(() => this.setData({ carouselVisible: false, carouselTransition: 'none' }), 200)
    }
  },

  onUnload() {
    this._unloaded = true
    clearTimeout(this._turnTimer)
    clearTimeout(this._handoffTimer)
    this._settling = false
  },

  onVideoError() {
    wx.showToast({ title: '视频播放失败', icon: 'none' })
  }
})
