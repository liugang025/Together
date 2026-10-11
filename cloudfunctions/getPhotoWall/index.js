const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

async function getTempUrlMap(fileIds) {
  const urlMap = {}
  const uniqueIds = [...new Set(fileIds.filter(Boolean))]
  // 云函数使用服务端权限生成封面地址，可读取另一位成员上传的图片。
  for (let start = 0; start < uniqueIds.length; start += 50) {
    try {
      const res = await cloud.getTempFileURL({ fileList: uniqueIds.slice(start, start + 50) })
      ;(res.fileList || []).forEach(item => {
        if (item.fileID && item.tempFileURL) urlMap[item.fileID] = item.tempFileURL
      })
    } catch (err) {
    }
  }
  return urlMap
}

function groupTodoAlbums(photos, todoMap) {
  const albumMap = {}
  photos.forEach(photo => {
    const todoId = photo.todoId || ''
    if (!todoId) return
    const todo = todoMap[todoId] || {}
    if (!albumMap[todoId]) {
      albumMap[todoId] = {
        todoId,
        title: photo.todoTitle || todo.title || '\u672a\u547d\u540d\u4e8b\u9879',
        count: 0,
        coverFileIds: []
      }
    }
    const album = albumMap[todoId]
    album.count += 1
    // 只携带最近的 3 张封面候选，避免为所有历史照片生成临时链接。
    const coverFileId = photo.mediaType === 'video' ? (photo.thumbnailFileId || '') : photo.fileId
    if (coverFileId && !album.coverFileIds.includes(coverFileId) && album.coverFileIds.length < 3) {
      album.coverFileIds.push(coverFileId)
    }
  })
  return Object.values(albumMap)
}

async function getAllPhotos(coupleId, todoIds) {
  const photos = []
  const knownIds = new Set()

  // 新照片都带有 coupleId，直接按两人空间读取，避免旧事项字段导致整组照片被过滤掉。
  const scopedRes = await db.collection('todo_photos')
    .where({ coupleId })
    // 客户端只取少量封面候选，因此必须优先返回最近上传、最可能有效的照片。
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()
  scopedRes.data.forEach(photo => {
    photos.push(photo)
    knownIds.add(photo._id)
  })

  // 兼容早期缺少 coupleId 的照片：即使一个事项已有新照片，也必须补查其旧照片，
  // 否则同一事项的相册数量会只统计到新记录。_id 去重保证不会重复计数。
  for (let start = 0; start < todoIds.length; start += 10) {
    const batchIds = todoIds.slice(start, start + 10)
    if (!batchIds.length) continue
    const res = await db.collection('todo_photos')
      .where({ todoId: _.in(batchIds) })
      .limit(100)
      .get()
    res.data.forEach(photo => {
      if (knownIds.has(photo._id)) return
      photos.push(photo)
      knownIds.add(photo._id)
    })
  }
  return photos
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
  if (!user.coupleId) {
    throw new Error('用户未绑定两人空间')
  }
  return user
}

exports.main = async () => {
  const user = await requireCoupleUser()
  const todosRes = await db.collection('todos')
    .where({ coupleId: user.coupleId })
    .limit(100)
    .get()
  const todos = todosRes.data.filter(todo => todo.type !== 'album')
  const allPhotos = await getAllPhotos(user.coupleId, todos.map(todo => todo._id))
  const todoPhotos = allPhotos.filter(photo => photo.source !== 'album' && photo.type !== 'album')
  const photos = todoPhotos
  const todoMap = {}
  todos.forEach(todo => {
    todoMap[todo._id] = todo
  })

  const todoAlbums = groupTodoAlbums(photos, todoMap)
  const coverUrlMap = await getTempUrlMap(todoAlbums.flatMap(item => item.coverFileIds))
  todoAlbums.forEach(album => {
    album.activeFileId = album.coverFileIds.find(fileId => coverUrlMap[fileId]) || ''
    album.coverUrl = coverUrlMap[album.activeFileId] || ''
    album.imageFailed = Boolean(album.coverFileIds.length && !album.coverUrl)
  })
  return { photos, todoAlbums }
}
