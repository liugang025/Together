const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

async function getCurrentUser() {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const users = await db.collection('users').where({ openid }).limit(1).get()
  if (!users.data.length) {
    throw new Error('用户未登录')
  }
  return users.data[0]
}

exports.main = async (event) => {
  const user = await getCurrentUser()
  if (!user.coupleId) {
    throw new Error('用户未绑定两人空间')
  }

  const todoId = String(event.todoId || '')
  if (!todoId) {
    throw new Error('缺少事项 ID')
  }

  const todoRes = await db.collection('todos').doc(todoId).get()
  const todo = todoRes.data
  if (!todo || todo.coupleId !== user.coupleId) {
    throw new Error('无权删除这个事项')
  }

  const photos = []
  // 云数据库单次查询上限为 20；边删除边继续查询，直至清空。
  const pageSize = 20
  while (true) {
    const photosRes = await db.collection('todo_photos').where({
      coupleId: user.coupleId,
      todoId
    }).limit(pageSize).get()
    if (!photosRes.data.length) break
    photos.push(...photosRes.data)
    for (const photo of photosRes.data) {
      await db.collection('todo_photos').doc(photo._id).remove()
    }
    if (photosRes.data.length < pageSize) break
  }

  await db.collection('todos').doc(todoId).remove()

  return {
    ok: true,
    deletedPhotos: photos.length
  }
}
