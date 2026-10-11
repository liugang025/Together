Page({
  data: {
    title: '',
    description: '',
    titleFocused: false,
    descriptionFocused: false,
    titlePlaceholder: '例如：一起去海边看日落',
    descriptionPlaceholder: '可以写下为什么想做、期待什么，也可以不填。',
    saving: false
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  onFocus(e) {
    const field = e.currentTarget.dataset.field
    if (field === 'title') {
      this.setData({ titleFocused: true })
      return
    }
    if (field === 'description') {
      this.setData({ descriptionFocused: true })
    }
  },

  onBlur(e) {
    const field = e.currentTarget.dataset.field
    if (field === 'title') {
      this.setData({ titleFocused: false })
      return
    }
    if (field === 'description') {
      this.setData({ descriptionFocused: false })
    }
  },

  async createTodo() {
    if (!this.data.title.trim()) {
      wx.showToast({ title: '先写一件想做的事', icon: 'none' })
      return
    }
    if (this.data.saving) return

    this.setData({ saving: true })
    wx.showLoading({ title: '保存中' })
    try {
      await wx.cloud.callFunction({
        name: 'createTodo',
        data: {
          title: this.data.title.trim(),
          description: this.data.description.trim()
        }
      })
      wx.hideLoading()
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  }
})
