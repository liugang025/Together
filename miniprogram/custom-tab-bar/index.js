Component({
  data: {
    selected: 0,
    hidden: false,
    list: [
      {
        pagePath: '/pages/todos/index',
        text: '清单'
      },
      {
        pagePath: '/pages/photo-wall/index',
        text: '照片'
      },
      {
        pagePath: '/pages/profile/index',
        text: '我们的'
      }
    ]
  },

  methods: {
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index)
      const item = this.data.list[index]
      if (!item) return
      wx.switchTab({
        url: item.pagePath,
        fail: () => wx.showToast({ title: '页面跳转失败', icon: 'none' })
      })
    }
  }
})
