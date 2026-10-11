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
  const user = await requireCoupleUser()
  const todoId = String(event.todoId || '')
  if (!todoId) {
    throw new Error('缺少事项 ID')
  }

  const todoRes = await db.collection('todos').doc(todoId).get()
  const todo = todoRes.data
  if (!todo || todo.coupleId !== user.coupleId) {
    throw new Error('无权修改这个事项')
  }

  const data = { updatedAt: db.serverDate() }
  if (typeof event.title === 'string' && event.title.trim()) data.title = event.title.trim()
  if (typeof event.description === 'string') data.description = event.description.trim()
  if (typeof event.category === 'string') data.category = event.category.trim()
  if (typeof event.plannedDate === 'string') data.plannedDate = event.plannedDate.trim()

  await db.collection('todos').doc(todoId).update({ data })
  return { ok: true }
}