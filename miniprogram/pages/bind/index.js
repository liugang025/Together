Page({
  data: {
    user: null,
    inviteCode: '',
    coupleName: '我们的日常',
    loading: false
  },

  onLoad(options = {}) {
    if (options.inviteCode) {
      this.setData({ inviteCode: String(options.inviteCode).trim().toUpperCase() })
    }
    this.loadUser()
  },

  async loadUser() {
    wx.showLoading({ title: '登录中' })
    try {
      const res = await wx.cloud.callFunction({ name: 'login' })
      const user = res.result.user
      getApp().globalData.user = user
      this.setData({ user })
      wx.hideLoading()

      if (user.coupleId) {
        wx.switchTab({ url: '/pages/todos/index' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '登录失败', icon: 'none' })
    }
  },

  onNameInput(e) {
    this.setData({ coupleName: e.detail.value })
  },

  onInviteInput(e) {
    this.setData({ inviteCode: e.detail.value.trim().toUpperCase() })
  },

  async createCouple() {
    if (this.data.loading) return
    this.setData({ loading: true })
    wx.showLoading({ title: '创建中' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'createCouple',
        data: { name: this.data.coupleName || '我们的日常' }
      })
      wx.hideLoading()
      this.setData({ user: res.result.user })

      const inviteCode = res.result && res.result.couple && res.result.couple.inviteCode
      wx.showModal({
        title: '创建成功',
        content: inviteCode ? ('邀请码：' + inviteCode + '\n点击“复制”后发给另一半，对方输入后就能加入。') : '创建成功，现在可以进入清单。',
        confirmText: inviteCode ? '复制' : '去清单',
        cancelText: '去清单',
        showCancel: !!inviteCode,
        success: (modalRes) => {
          if (inviteCode && modalRes.confirm) {
            wx.setClipboardData({
              data: inviteCode,
              success: () => wx.switchTab({ url: '/pages/todos/index' }),
              fail: () => wx.switchTab({ url: '/pages/todos/index' })
            })
            return
          }
          wx.switchTab({ url: '/pages/todos/index' })
        }
      })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '创建失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async joinCouple() {
    if (!this.data.inviteCode) {
      wx.showToast({ title: '请输入邀请码', icon: 'none' })
      return
    }

    wx.showLoading({ title: '加入中' })
    try {
      await wx.cloud.callFunction({
        name: 'joinCouple',
        data: { inviteCode: this.data.inviteCode }
      })
      wx.hideLoading()
      wx.switchTab({ url: '/pages/todos/index' })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '加入失败', icon: 'none' })
    }
  }
})