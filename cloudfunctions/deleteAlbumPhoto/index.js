const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

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

const _ = db.command

exports.main = async (event) => {
  const user = await requireCoupleUser()
  const photoId = String(event.photoId || '')
  if (!photoId) throw new Error('\u7f3a\u5c11\u7167\u7247 ID')

  const photoRes = await db.collection('todo_photos').doc(photoId).get()
  const photo = photoRes.data
  if (!photo || photo.coupleId !== user.coupleId || photo.source !== 'album') {
    throw new Error('\u65e0\u6743\u5220\u9664\u8fd9\u5f20\u7167\u7247')
  }

  await db.collection('todo_photos').doc(photoId).remove()
  const leftRes = await db.collection('todo_photos')
    .where({ coupleId: user.coupleId, todoId: photo.todoId, source: 'album' })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get()
  const nextCover = leftRes.data[0] ? leftRes.data[0].fileId : ''
  await db.collection('todos').doc(photo.todoId).update({
    data: { photoCount: _.inc(-1), coverFileId: nextCover, updatedAt: db.serverDate() }
  })

  return { ok: true }
}
