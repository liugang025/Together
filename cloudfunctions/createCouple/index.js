const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

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
  if (!user.coupleId) {
    throw new Error('用户未绑定两人空间')
  }
  return user
}

function createInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

exports.main = async (event) => {
  const user = await getCurrentUser()
  if (user.coupleId) {
    throw new Error('你已经绑定了两人空间')
  }

  let inviteCode = createInviteCode()
  for (let i = 0; i < 5; i += 1) {
    const exists = await db.collection('couples').where({ inviteCode }).limit(1).get()
    if (!exists.data.length) break
    inviteCode = createInviteCode()
  }

  const now = db.serverDate()
  const coupleData = {
    name: event.name || '我们的日常',
    ownerOpenid: user.openid,
    partnerOpenid: '',
    inviteCode,
    status: 'pending',
    createdAt: now,
    updatedAt: now
  }
  const coupleRes = await db.collection('couples').add({ data: coupleData })
  const coupleId = coupleRes._id

  await db.collection('users').doc(user._id).update({
    data: {
      coupleId,
      role: 'owner',
      updatedAt: now
    }
  })

  return {
    user: { ...user, coupleId, role: 'owner' },
    couple: { _id: coupleId, ...coupleData }
  }
}