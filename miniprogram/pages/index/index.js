Page({
  onLoad() {
    this.bootstrap()
  },

  async bootstrap() {
    wx.showLoading({ title: '加载中' })
    try {
      const res = await wx.cloud.callFunction({ name: 'login' })
      const user = res.result.user
      getApp().globalData.user = user
      wx.hideLoading()

      if (user && user.coupleId) {
        wx.switchTab({ url: '/pages/todos/index' })
      } else {
        wx.redirectTo({ url: '/pages/bind/index' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showModal({
        title: '登录失败',
        content: err.message || '请确认已上传 login 云函数。',
        showCancel: false
      })
    }
  }
})