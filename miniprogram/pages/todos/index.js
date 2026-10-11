const TODO_CACHE_KEY = 'daily_todos_cache_v1'

Page({
  data: {
    todos: [],
    filter: 'all',
    openedTodoId: '',
    touchStartX: 0,
    touchStartY: 0,
    touchMoved: false,
    draggingId: '',
    dragStartIndex: -1,
    dragCurrentIndex: -1,
    dragOffsetY: 0,
    itemHeight: 61,
    stats: {
      total: 0,
      todo: 0,
      done: 0
    }
  },

  onShow() {
    this.setTabBarSelected()
    this.applyCachedTodos()
    this.loadTodos({ silent: true })
  },

  setTabBarSelected() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
  },

  onPullDownRefresh() {
    this.loadTodos().finally(() => wx.stopPullDownRefresh())
  },

  setFilter(e) {
    const filter = e.currentTarget.dataset.filter || 'all'
    this.setData({ filter, openedTodoId: '', draggingId: '' }, () => {
      this.applyCachedTodos()
      this.loadTodos({ silent: true })
    })
  },

  applyCachedTodos() {
    try {
      const allTodos = wx.getStorageSync(TODO_CACHE_KEY) || []
      if (!allTodos.length) return
      this.applyTodos(allTodos)
    } catch (err) {
    }
  },

  applyTodos(allTodos) {
    const status = this.data.filter === 'all' ? '' : this.data.filter
    const todos = status ? allTodos.filter(item => item.status === status) : allTodos
    this.setData({
      todos,
      stats: {
        total: allTodos.length,
        todo: allTodos.filter(item => item.status === 'todo').length,
        done: allTodos.filter(item => item.status === 'done').length
      }
    })
  },

  async loadTodos(options = {}) {
    try {
      const allRes = await wx.cloud.callFunction({ name: 'getTodos', data: {} })
      const allTodos = (allRes.result && allRes.result.todos) || []
      wx.setStorageSync(TODO_CACHE_KEY, allTodos)
      this.applyTodos(allTodos)
    } catch (err) {
      const message = (err && err.message) || ''
      if (message.includes('\u672a\u7ed1\u5b9a')) {
        wx.redirectTo({ url: '/pages/bind/index' })
        return
      }
      if (!options.silent || !this.data.todos.length) {
        wx.showToast({ title: '\u52a0\u8f7d\u5931\u8d25', icon: 'none' })
      }
    }
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/todo-create/index' })
  },

  noop() {},

  onTodoLongPress(e) {
    if (this.data.filter !== 'all') {
      wx.showToast({ title: '\u5168\u90e8\u5217\u8868\u4e2d\u624d\u80fd\u6392\u5e8f', icon: 'none' })
      return
    }
    const index = Number(e.currentTarget.dataset.index)
    const id = e.currentTarget.dataset.id
    if (!id || index < 0) return
    wx.vibrateShort({ type: 'light' })
    this.setData({
      draggingId: id,
      dragStartIndex: index,
      dragCurrentIndex: index,
      dragOffsetY: 0,
      openedTodoId: '',
      touchMoved: true
    })
  },

  onTodoTouchStart(e) {
    const touch = e.touches[0]
    this.setData({
      touchStartX: touch.clientX,
      touchStartY: touch.clientY,
      touchMoved: false
    })
  },

  onTodoTouchMove(e) {
    const touch = e.touches[0]
    const deltaX = touch.clientX - this.data.touchStartX
    const deltaY = touch.clientY - this.data.touchStartY

    if (this.data.draggingId) {
      const offset = Math.round(deltaY / this.data.itemHeight)
      const maxIndex = this.data.todos.length - 1
      const nextIndex = Math.max(0, Math.min(maxIndex, this.data.dragStartIndex + offset))
      if (nextIndex !== this.data.dragCurrentIndex) {
        this.reorderDraggingTodo(nextIndex)
      }
      const localOffset = deltaY - offset * this.data.itemHeight
      const dragOffsetY = Math.max(-28, Math.min(28, localOffset))
      this.setData({ touchMoved: true, dragOffsetY })
      return
    }

    if (Math.abs(deltaX) > 12 || Math.abs(deltaY) > 12) {
      this.setData({ touchMoved: true })
    }
  },

  onTodoTouchEnd(e) {
    if (this.data.draggingId) {
      this.finishDragSort()
      return
    }

    const touch = e.changedTouches[0]
    const deltaX = touch.clientX - this.data.touchStartX
    const deltaY = Math.abs(touch.clientY - this.data.touchStartY)
    const id = e.currentTarget.dataset.id
    if (deltaY > 45) return
    if (deltaX < -42) {
      this.setData({ openedTodoId: id })
      return
    }
    if (deltaX > 30 && this.data.openedTodoId === id) {
      this.setData({ openedTodoId: '' })
    }
  },

  reorderDraggingTodo(nextIndex) {
    const todos = this.data.todos.slice()
    const currentIndex = todos.findIndex(item => item._id === this.data.draggingId)
    if (currentIndex < 0 || currentIndex === nextIndex) return
    const moving = todos.splice(currentIndex, 1)[0]
    todos.splice(nextIndex, 0, moving)
    this.setData({ todos, dragCurrentIndex: nextIndex })
  },

  async finishDragSort() {
    const changed = this.data.dragStartIndex !== this.data.dragCurrentIndex
    const orderedIds = this.data.todos.map(item => item._id)
    this.setData({ draggingId: '', dragStartIndex: -1, dragCurrentIndex: -1, dragOffsetY: 0 })
    if (!changed) return
    try {
      wx.setStorageSync(TODO_CACHE_KEY, this.data.todos)
      await wx.cloud.callFunction({ name: 'updateTodoOrder', data: { orderedIds } })
    } catch (err) {
      wx.showToast({ title: '\u6392\u5e8f\u4fdd\u5b58\u5931\u8d25', icon: 'none' })
      this.loadTodos()
    }
  },

  async toggleTodo(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showLoading({ title: '\u66f4\u65b0\u4e2d' })
    try {
      await wx.cloud.callFunction({ name: 'toggleTodoStatus', data: { todoId: id } })
      wx.hideLoading()
      this.setData({ openedTodoId: '' })
      this.loadTodos()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '\u66f4\u65b0\u5931\u8d25', icon: 'none' })
    }
  },

  deleteTodo(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '\u5220\u9664\u8fd9\u4ef6\u4e8b\uff1f',
      content: '\u5220\u9664\u540e\uff0c\u8fd9\u4ef6\u4e8b\u548c\u5b83\u4e0b\u9762\u7684\u7167\u7247\u8bb0\u5f55\u90fd\u4f1a\u88ab\u5220\u9664\u3002',
      confirmText: '\u5220\u9664',
      confirmColor: '#ff6f85',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '\u5220\u9664\u4e2d' })
        try {
          await wx.cloud.callFunction({ name: 'deleteTodo', data: { todoId: id } })
          wx.hideLoading()
          wx.showToast({ title: '\u5df2\u5220\u9664', icon: 'success' })
          this.setData({ openedTodoId: '' })
          this.loadTodos()
        } catch (err) {
          wx.hideLoading()
          const message = (err && (err.errMsg || err.message)) || ''
          const title = message.includes('Function name parameter could not be found') || message.includes('-501000')
            ? '删除事项功能未部署'
            : '删除失败，请稍后重试'
          wx.showToast({ title, icon: 'none' })
        }
      }
    })
  },

  openDetail(e) {
    if (this.data.touchMoved || this.data.draggingId) return
    if (this.data.openedTodoId) {
      this.setData({ openedTodoId: '' })
      return
    }
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/todo-detail/index?id=' + id })
  }
})
