const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function makeThumbnailUrl(url) {
  if (!url) return ''
  const separator = url.includes('?') ? '&' : '?'
  return url + separator + 'imageMogr2/thumbnail/480x/quality/72/format/webp'
}

async function attachTempUrls(photos) {
  const fileList = [...new Set(photos.flatMap(photo => [photo.fileId, photo.thumbnailFileId]).filter(Boolean))]
  if (!fileList.length) return photos

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
  return photos.map(photo => {
    const originalDisplayUrl = urlMap[photo.fileId] || ''
    const thumbnailUrl = urlMap[photo.thumbnailFileId] || ''
    const isVideo = photo.mediaType === 'video'
    const isGif = photo.contentType === 'image/gif' || /\.gif(?:\?|$)/i.test(String(photo.fileId || ''))
    return {
      ...photo,
      displayUrl: isVideo ? thumbnailUrl : (isGif ? originalDisplayUrl : makeThumbnailUrl(originalDisplayUrl)),
      thumbnailUrl,
      originalDisplayUrl
    }
  })
}

async function getPhotos(coupleId, albumId, skip, pageSize) {
  const res = await db.collection('todo_photos')
    .where({ coupleId, todoId: albumId, source: 'album' })
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()
  return res.data
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

exports.main = async (event) => {
  const user = await requireCoupleUser()
  const albumId = String(event.albumId || '')
  if (!albumId) throw new Error('\u7f3a\u5c11\u76f8\u518c ID')
  const requestedPageSize = Number(event.pageSize)
  const pageSize = Number.isFinite(requestedPageSize) && requestedPageSize > 0
    ? Math.min(100, Math.floor(requestedPageSize))
    : 12
  const skip = Math.max(0, Number(event.skip) || 0)

  const albumRes = await db.collection('todos').doc(albumId).get()
  const albumDoc = albumRes.data
  if (!albumDoc || albumDoc.coupleId !== user.coupleId || albumDoc.type !== 'album') {
    throw new Error('\u65e0\u6743\u67e5\u770b\u8fd9\u4e2a\u76f8\u518c')
  }

  const photos = await getPhotos(user.coupleId, albumId, skip, pageSize)

  return {
    album: { _id: albumDoc._id, name: albumDoc.title, coverFileId: albumDoc.coverFileId || '', photoCount: albumDoc.photoCount || 0, createdAt: albumDoc.createdAt || null },
    photos: await attachTempUrls(photos),
    hasMore: photos.length === pageSize
  }
}
