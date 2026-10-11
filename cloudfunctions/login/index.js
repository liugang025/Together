const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const users = await db.collection('users').where({ openid }).limit(1).get()
  const now = db.serverDate()
  let user

  const profile = {
    nickName: String(event.nickName || '').trim(),
    avatarUrl: String(event.avatarUrl || '').trim()
  }

  if (users.data.length) {
    user = users.data[0]
    const updateData = { updatedAt: now }
    if (profile.nickName) updateData.nickName = profile.nickName
    if (profile.avatarUrl) updateData.avatarUrl = profile.avatarUrl
    await db.collection('users').doc(user._id).update({ data: updateData })
    user = { ...user, ...updateData }
  } else {
    const userData = {
      openid,
      nickName: profile.nickName,
      avatarUrl: profile.avatarUrl,
      coupleId: '',
      role: '',
      createdAt: now,
      updatedAt: now
    }
    const addRes = await db.collection('users').add({ data: userData })
    user = { _id: addRes._id, ...userData }
  }

  let couple = null
  let members = []
  if (user.coupleId) {
    const coupleRes = await db.collection('couples').doc(user.coupleId).get().catch(() => null)
    couple = coupleRes && coupleRes.data ? coupleRes.data : null
    const memberMap = {}
    const memberRes = await db.collection('users').where({ coupleId: user.coupleId }).get()
    memberRes.data.forEach(item => { memberMap[item.openid] = item })

    if (couple) {
      const openids = [couple.ownerOpenid, couple.partnerOpenid].filter(Boolean)
      for (const memberOpenid of openids) {
        if (!memberMap[memberOpenid]) {
          const byOpenid = await db.collection('users').where({ openid: memberOpenid }).limit(1).get()
          if (byOpenid.data.length) memberMap[memberOpenid] = byOpenid.data[0]
        }
      }
    }

    members = Object.values(memberMap).map(item => ({
      _id: item._id,
      openid: item.openid,
      nickName: item.nickName || '',
      avatarUrl: item.avatarUrl || '',
      role: item.role || ''
    }))
  }

  return { user, couple, members }
}