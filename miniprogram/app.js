App({
  globalData: {
    env: 'cloud1-d1g0664ch79be5fa9',
    user: null,
    previewMediaState: null
  },

  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({
        title: '基础库版本过低',
        content: '请使用 2.2.3 或以上基础库以使用云开发能力。',
        showCancel: false
      })
      return
    }

    wx.cloud.init({
      env: this.globalData.env,
      traceUser: true
    })
  }
})
