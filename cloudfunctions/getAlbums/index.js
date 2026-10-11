const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

async function attachCoverUrls(albums) {
  const fileList = albums.map(album => album.coverFileId).filter(Boolean)
  if (!fileList.length) return albums

  const urlMap = {}
  for (let start = 0; start < fileList.length; start += 50) {
    try {
      const tempRes = await cloud.getTempFileURL({ fileList: fileList.slice(start, start + 50) })
    ;(tempRes.fileList || []).forEach(item => {
      urlMap[item.fileID] = item.tempFileURL || ''
    })
    } catch (err) {
    }
  }
  return albums.map(album => ({ ...album, coverUrl: urlMap[album.coverFileId] || '' }))
}

async function getCurrentUser() {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const users = await db.collection('users').where({ openid }).get()
  const now = db.serverDate()
  let user = users.data.find(item => item.coupleId) || users.data[0]

  const owned = await db.collection('couples').where({ ownerOpenid: openid }).limit(1).get()
  const joined = await db.collection('couples').where({ partnerOpenid: openid }).limit(1).get()
  const couple = owned.data[0] || joined.data[0] || null

  if (!user) {
    const userData = {
      openid,
      nickName: '',
      avatarUrl: '',
      coupleId: couple ? couple._id : '',
      role: couple ? (couple.ownerOpenid === openid ? 'owner' : 'partner') : '',
      createdAt: now,
      updatedAt: now
    }
    const addRes = await db.collection('users').add({ data: userData })
    return { _id: addRes._id, ...userData }
  }

  if (couple && user.coupleId !== couple._id) {
    const role = couple.ownerOpenid === openid ? 'owner' : 'partner'
    await db.collection('users').doc(user._id).update({
      data: { coupleId: couple._id, role, updatedAt: now }
    })
    user = { ...user, coupleId: couple._id, role, updatedAt: now }
  }

  return user
}

async function requireCoupleUser() {
  const user = await getCurrentUser()
  if (!user.coupleId) throw new Error('\u7528\u6237\u672a\u7ed1\u5b9a\u4e24\u4eba\u7a7a\u95f4')
  return user
}

exports.main = async () => {
  const user = await requireCoupleUser()
  const [res, photoRes] = await Promise.all([
    db.collection('todos')
    .where({ coupleId: user.coupleId, type: 'album' })
    .orderBy('updatedAt', 'desc')
    .limit(100)
    .get(),
    db.collection('todo_photos')
      .where({ coupleId: user.coupleId, source: 'album' })
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get()
  ])
  const coverCandidates = {}
  photoRes.data.forEach(photo => {
    if (!photo.todoId || !photo.fileId) return
    if (!coverCandidates[photo.todoId]) coverCandidates[photo.todoId] = []
    coverCandidates[photo.todoId].push(photo.fileId)
  })
  const albums = res.data.map(item => ({
    _id: item._id,
    name: item.title,
    coverFileId: item.coverFileId || '',
    // 返回所有候选封面，客户端会跳过已失效的云文件。
    coverFileIds: [...new Set([item.coverFileId, ...(coverCandidates[item._id] || [])].filter(Boolean))],
    photoCount: item.photoCount || 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }))
  return { albums: await attachCoverUrls(albums) }
}
