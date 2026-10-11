Page({
  data: {
    user: null,
    couple: null,
    members: [],
    ownerName: '我',
    ownerNameInput: '',
    ownerAvatar: '',
    partnerName: '另一个人',
    partnerAvatar: '',
    partnerJoined: false,
    inviteCode: '',
    savingProfile: false,
    showPeopleCard: false,
    timeCounters: [
      { key: 'meet', label: '\u8ba4\u8bc6', dateText: '2026.06.20', days: 0, hours: '00', minutes: '00', seconds: '00' },
      { key: 'love', label: '\u5728\u4e00\u8d77', dateText: '2026.07.17', days: 0, hours: '00', minutes: '00', seconds: '00' }
    ],
    // 透明爱心周围持续漂浮的微粒，保持页面轻盈且有生命感。
    heartDust: [
      { x: 21, y: 26, size: 7, delay: 0.1, duration: 3.8, motion: 'a' }, { x: 74, y: 22, size: 6, delay: 1.4, duration: 4.2, motion: 'b' },
      { x: 14, y: 43, size: 5, delay: 0.8, duration: 4.6, motion: 'c' }, { x: 84, y: 47, size: 8, delay: 2.1, duration: 3.9, motion: 'a' },
      { x: 27, y: 16, size: 5, delay: 2.6, duration: 4.4, motion: 'b' }, { x: 68, y: 14, size: 7, delay: 0.5, duration: 4.8, motion: 'c' },
      { x: 34, y: 35, size: 4, delay: 1.8, duration: 3.7, motion: 'a' }, { x: 64, y: 36, size: 5, delay: 2.9, duration: 4.3, motion: 'b' },
      { x: 23, y: 63, size: 6, delay: 0.3, duration: 4.5, motion: 'c' }, { x: 76, y: 66, size: 5, delay: 1.2, duration: 3.6, motion: 'a' },
      { x: 40, y: 24, size: 4, delay: 3.1, duration: 4.7, motion: 'b' }, { x: 59, y: 26, size: 5, delay: 0.7, duration: 4.1, motion: 'c' },
      { x: 48, y: 76, size: 6, delay: 2.3, duration: 4.9, motion: 'a' }, { x: 53, y: 81, size: 4, delay: 1.6, duration: 3.8, motion: 'b' },
      { x: 18, y: 31, size: 4, delay: 0.9, duration: 4.1, motion: 'b' }, { x: 80, y: 31, size: 5, delay: 2.5, duration: 4.5, motion: 'c' },
      { x: 17, y: 52, size: 4, delay: 1.7, duration: 3.9, motion: 'a' }, { x: 83, y: 55, size: 5, delay: 0.2, duration: 4.7, motion: 'b' },
      { x: 25, y: 72, size: 4, delay: 3.0, duration: 4.2, motion: 'c' }, { x: 73, y: 74, size: 4, delay: 1.1, duration: 3.8, motion: 'a' },
      { x: 31, y: 82, size: 5, delay: 2.8, duration: 4.6, motion: 'b' }, { x: 68, y: 83, size: 4, delay: 0.6, duration: 4.0, motion: 'c' },
      { x: 38, y: 88, size: 4, delay: 1.9, duration: 4.4, motion: 'a' }, { x: 61, y: 89, size: 5, delay: 2.2, duration: 3.7, motion: 'b' },
      { x: 12, y: 38, size: 3, delay: 0.4, duration: 4.8, motion: 'c' }, { x: 88, y: 39, size: 4, delay: 2.7, duration: 4.3, motion: 'a' }
    ]
  },

  onShow() {
    this.setTabBarSelected()
    this.loadProfile()
    this.startTimeCounter()
  },

  onHide() {
    this.stopTimeCounter()
  },

  onUnload() {
    this.stopTimeCounter()
  },

  startTimeCounter() {
    this.updateTimeCounter()
    this.stopTimeCounter()
    this.timeCounterTimer = setInterval(() => this.updateTimeCounter(), 1000)
  },

  stopTimeCounter() {
    if (!this.timeCounterTimer) return
    clearInterval(this.timeCounterTimer)
    this.timeCounterTimer = null
  },

  updateTimeCounter() {
    const starts = [
      { key: 'meet', label: '\u8ba4\u8bc6', dateText: '2026.06.20', time: new Date(2026, 5, 20).getTime() },
      { key: 'love', label: '\u5728\u4e00\u8d77', dateText: '2026.07.17', time: new Date(2026, 6, 17).getTime() }
    ]
    const now = Date.now()
    const timeCounters = starts.map(item => {
      const diff = Math.max(0, now - item.time)
      const totalSeconds = Math.floor(diff / 1000)
      const days = Math.floor(totalSeconds / 86400)
      const hours = Math.floor((totalSeconds % 86400) / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const seconds = totalSeconds % 60
      return {
        key: item.key,
        label: item.label,
        dateText: item.dateText,
        days,
        hours: String(hours).padStart(2, '0'),
        minutes: String(minutes).padStart(2, '0'),
        seconds: String(seconds).padStart(2, '0')
      }
    })
    this.setData({ timeCounters })
  },

  setTabBarSelected() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
  },

  async loadProfile() {
    wx.showLoading({ title: '加载中' })
    try {
      const res = await wx.cloud.callFunction({ name: 'login', data: {} })
      wx.hideLoading()
      const result = res.result || {}
      const members = result.members || []
      const user = result.user || null
      const couple = result.couple || null
      const me = (user && user.openid ? members.find(item => item.openid === user.openid) : null) || user || null
      const other = members.find(item => user && item.openid && item.openid !== user.openid) || null
      const hasPartner = !!(other || (couple && couple.partnerOpenid) || (couple && couple.status === 'active'))
      const ownerName = me && me.nickName ? me.nickName : '我'
      const ownerAvatarFile = me && me.avatarUrl ? me.avatarUrl : ''
      const partnerAvatarFile = other && other.avatarUrl ? other.avatarUrl : ''
      const avatarMap = await this.getAvatarUrlMap([ownerAvatarFile, partnerAvatarFile])
      const ownerAvatar = avatarMap[ownerAvatarFile] || ownerAvatarFile
      const partnerAvatar = avatarMap[partnerAvatarFile] || partnerAvatarFile
      this.setData({
        user,
        couple,
        inviteCode: couple && couple.inviteCode ? couple.inviteCode : '',
        members,
        ownerName,
        ownerNameInput: ownerName === '我' ? '' : ownerName,
        ownerAvatar,
        partnerName: other && other.nickName ? other.nickName : (hasPartner ? '已加入' : '另一个人'),
        partnerAvatar,
        partnerJoined: hasPartner
      })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  async getAvatarUrlMap(fileIds) {
    const cloudIds = fileIds.filter(item => item && item.indexOf('cloud://') === 0)
    if (!cloudIds.length) return {}
    try {
      const res = await wx.cloud.getTempFileURL({ fileList: cloudIds })
      const map = {}
      ;(res.fileList || []).forEach(item => {
        map[item.fileID] = item.tempFileURL || item.fileID
      })
      return map
    } catch (err) {
      return {}
    }
  },

  async onChooseAvatar(e) {
    const tempAvatarUrl = e.detail.avatarUrl
    if (!tempAvatarUrl) return
    wx.showLoading({ title: '上传中' })
    try {
      const extMatch = tempAvatarUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)
      const ext = extMatch ? extMatch[1] : 'png'
      const cloudPath = 'avatars/' + Date.now() + '-' + Math.floor(Math.random() * 100000) + '.' + ext
      const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: tempAvatarUrl })
      wx.hideLoading()
      this.setData({ ownerAvatar: uploadRes.fileID })
      this.saveWechatProfile({ avatarUrl: uploadRes.fileID })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '头像上传失败', icon: 'none' })
    }
  },

  onOwnerAvatarError() {
    this.setData({ ownerAvatar: '' })
  },

  onPartnerAvatarError() {
    this.setData({ partnerAvatar: '' })
  },

  editDisplayName() {
    wx.showModal({
      title: '设置显示名',
      editable: true,
      placeholderText: '输入你想显示的名字',
      content: this.data.ownerNameInput || '',
      confirmText: '保存',
      confirmColor: '#ff6f85',
      success: (res) => {
        if (!res.confirm) return
        const nickName = (res.content || '').trim()
        if (!nickName) {
          wx.showToast({ title: '名字不能为空', icon: 'none' })
          return
        }
        this.setData({ ownerNameInput: nickName })
        this.saveWechatProfile({ detail: { value: nickName } })
      }
    })
  },

  async saveWechatProfile(e) {
    if (this.data.savingProfile) return
    const eventValue = e && e.detail && typeof e.detail.value === 'string' ? e.detail.value : ''
    const nickName = (eventValue || this.data.ownerNameInput || '').trim()
    const avatarUrl = (e && e.avatarUrl) || this.data.ownerAvatar || ''
    if (!nickName && !avatarUrl) return
    this.setData({ savingProfile: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'login', data: { nickName, avatarUrl } })
      const user = res.result && res.result.user ? res.result.user : this.data.user
      if (getApp && getApp()) getApp().globalData.user = user
      this.setData({
        user,
        ownerName: user && user.nickName ? user.nickName : (nickName || '我'),
        ownerNameInput: user && user.nickName ? user.nickName : nickName,
        ownerAvatar: user && user.avatarUrl ? user.avatarUrl : avatarUrl
      })
      wx.showToast({ title: '已同步', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: '同步失败', icon: 'none' })
    } finally {
      this.setData({ savingProfile: false })
    }
  },

  showInviteCode() {
    const inviteCode = this.data.inviteCode
    if (!inviteCode) {
      wx.showToast({ title: '暂时没有邀请码', icon: 'none' })
      return
    }
    wx.showModal({
      title: '邀请码',
      content: inviteCode + '\n发给另一半，对方在绑定页输入即可加入。',
      confirmText: '复制',
      cancelText: '关闭',
      confirmColor: '#ff6f85',
      success: (res) => {
        if (!res.confirm) return
        wx.setClipboardData({ data: inviteCode })
      }
    })
  }
})
