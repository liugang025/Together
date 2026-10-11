Page({
  data: {
    results: [],
    running: false
  },

  async initDatabase() {
    if (this.data.running) return
    this.setData({ running: true, results: [] })
    wx.showLoading({ title: '创建集合中' })
    try {
      const res = await wx.cloud.callFunction({ name: 'initDatabase' })
      wx.hideLoading()
      this.setData({ results: res.result.results || [] })
      wx.showToast({ title: res.result.success ? '初始化完成' : '部分失败', icon: 'none' })
    } catch (err) {
      wx.hideLoading()
      wx.showModal({
        title: '初始化失败',
        content: err.message || '请先上传 initDatabase 云函数。',
        showCancel: false
      })
    } finally {
      this.setData({ running: false })
    }
  },

  goApp() {
    wx.redirectTo({ url: '/pages/index/index' })
  }
})