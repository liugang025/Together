const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

async function getCurrentUser() {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const [users, owned, joined] = await Promise.all([
    db.collection('users').where({ openid }).get(),
    db.collection('couples').where({ ownerOpenid: openid }).limit(1).get(),
    db.collection('couples').where({ partnerOpenid: openid }).limit(1).get()
  ])
  const now = db.serverDate()
  let user = users.data.find(item => item.coupleId) || users.data[0]
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

function createUploadError(code, detail = '') {
  const error = new Error(detail ? code + ': ' + detail : code)
  error.code = code
  return error
}

function getErrorDetail(err) {
  return String((err && (err.errCode || err.errMsg || err.message)) || 'unknown error').slice(0, 180)
}

function findModerationResult(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return null
  if (Object.prototype.hasOwnProperty.call(value, 'suggest') || Object.prototype.hasOwnProperty.call(value, 'label')) return value
  for (const key of ['result', 'data']) {
    const found = findModerationResult(value[key], depth + 1)
    if (found) return found
  }
  return null
}

function summarizeCheckResult(value) {
  try {
    return JSON.stringify(value).slice(0, 500)
  } catch (err) {
    return Object.prototype.toString.call(value)
  }
}

function isUnsafeCheckError(err) {
  return /(?:^|\D)87014(?:\D|$)|risky|violate/i.test(getErrorDetail(err))
}

function normalizeContentType(value) {
  const type = String(value || '').toLowerCase()
  if (/^image\/(jpeg|jpg|png|webp|gif)$/.test(type)) return type === 'image/jpg' ? 'image/jpeg' : type
  return 'image/jpeg'
}

async function removeRejectedFile(fileId) {
  try {
    await cloud.deleteFile({ fileList: [fileId] })
  } catch (err) {
    console.warn('删除违规图片失败', err)
  }
}

async function assertSafeImage(fileId, openid, contentType, checkFileId = fileId) {
  let download
  try {
    download = await cloud.downloadFile({ fileID: checkFileId })
  } catch (err) {
    console.error('下载待检测图片失败', err)
    if (checkFileId !== fileId) await removeRejectedFile(checkFileId)
    throw createUploadError('CONTENT_CHECK_FAILED', getErrorDetail(err))
  }

  let checkResult
  try {
    checkResult = await cloud.openapi.security.imgSecCheck({
      media: { contentType: normalizeContentType(contentType), value: download.fileContent },
      version: 2,
      scene: 1,
      openid
    })
  } catch (err) {
    console.error('图片内容安全检测失败', err)
    if (checkFileId !== fileId) await removeRejectedFile(checkFileId)
    if (isUnsafeCheckError(err)) {
      await removeRejectedFile(fileId)
      throw createUploadError('CONTENT_UNSAFE')
    }
    throw createUploadError('CONTENT_CHECK_FAILED', getErrorDetail(err))
  }

  if (checkFileId !== fileId) await removeRejectedFile(checkFileId)

  const result = findModerationResult(checkResult)
  const suggest = String(result && result.suggest || '').toLowerCase()
  const labelValue = result && result.label
  const label = labelValue === undefined || labelValue === null || labelValue === '' ? NaN : Number(labelValue)
  if (!suggest && !Number.isFinite(label)) {
    // imgSecCheck 云调用的标准成功响应只有 errCode/errMsg；违规图片会以 87014 抛出异常。
    if (checkResult && checkResult.errCode !== undefined && Number(checkResult.errCode) === 0) return
    const detail = '图片审核接口未返回可识别的审核结论: ' + summarizeCheckResult(checkResult)
    console.error(detail)
    throw createUploadError('CONTENT_CHECK_FAILED', detail)
  }
  const unsafe = suggest ? suggest !== 'pass' : (Number.isFinite(label) && label !== 100)
  if (unsafe) {
    await removeRejectedFile(fileId)
    throw createUploadError('CONTENT_UNSAFE')
  }
}

exports.main = async (event) => {
  const user = await requireCoupleUser()
  const albumId = String(event.albumId || '')
  const fileId = String(event.fileId || '')
  if (!albumId || !fileId) throw new Error('\u7f3a\u5c11\u76f8\u518c\u6216\u7167\u7247')

  const albumRes = await db.collection('todos').doc(albumId).get()
  const album = albumRes.data
  if (!album || album.coupleId !== user.coupleId || album.type !== 'album') {
    throw new Error('\u65e0\u6743\u4e0a\u4f20\u5230\u8fd9\u4e2a\u76f8\u518c')
  }

  const mediaType = event.mediaType === 'video' ? 'video' : 'image'
  if (mediaType === 'image') {
    const checkFileId = String(event.checkFileId || fileId)
    await assertSafeImage(fileId, user.openid, event.checkContentType || event.contentType, checkFileId)
  }

  const now = db.serverDate()
  const addRes = await db.collection('todo_photos').add({
    data: {
      coupleId: user.coupleId,
      todoId: albumId,
      todoTitle: album.title,
      fileId,
      mediaType,
      contentType: String(event.contentType || ''),
      thumbnailFileId: String(event.thumbnailFileId || ''),
      source: 'album',
      type: 'album',
      description: '',
      createdBy: user.openid,
      createdAt: now
    }
  })

  const updateData = { photoCount: _.inc(1), updatedAt: now }
  if (!album.coverFileId && (mediaType !== 'video' || event.thumbnailFileId)) {
    updateData.coverFileId = mediaType === 'video' ? String(event.thumbnailFileId) : fileId
  }
  await db.collection('todos').doc(albumId).update({ data: updateData })

  return { ok: true, photoId: addRes._id }
}
