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

exports.main = async (event) => {
  const user = await getCurrentUser()
  if (user.coupleId) {
    throw new Error('你已经绑定了两人空间')
  }

  const inviteCode = String(event.inviteCode || '').trim().toUpperCase()
  if (!inviteCode) {
    throw new Error('邀请码不能为空')
  }

  const couples = await db.collection('couples').where({ inviteCode }).limit(1).get()
  if (!couples.data.length) {
    throw new Error('邀请码不存在')
  }

  const couple = couples.data[0]
  if (couple.partnerOpenid && couple.partnerOpenid !== user.openid) {
    throw new Error('这个空间已经绑定了两个人')
  }
  if (couple.ownerOpenid === user.openid) {
    throw new Error('不能加入自己创建的空间')
  }

  const now = db.serverDate()
  await db.collection('couples').doc(couple._id).update({
    data: {
      partnerOpenid: user.openid,
      status: 'active',
      updatedAt: now
    }
  })

  await db.collection('users').doc(user._id).update({
    data: {
      coupleId: couple._id,
      role: 'partner',
      updatedAt: now
    }
  })

  return {
    user: { ...user, coupleId: couple._id, role: 'partner' },
    couple: { ...couple, partnerOpenid: user.openid, status: 'active' }
  }
}