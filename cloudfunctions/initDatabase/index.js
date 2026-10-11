const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

async function createCollection(name) {
  try {
    await db.createCollection(name)
    return { name, status: 'created' }
  } catch (err) {
    const message = err.message || err.errMsg || ''
    if (
      message.includes('already exists') ||
      message.includes('collection exists') ||
      message.includes('DATABASE_COLLECTION_ALREADY_EXIST') ||
      message.includes('Collection already exists')
    ) {
      return { name, status: 'exists' }
    }
    return { name, status: 'failed', message }
  }
}

exports.main = async () => {
  const collections = ['users', 'couples', 'todos', 'todo_photos', 'albums', 'album_photos']
  const results = []

  for (const name of collections) {
    results.push(await createCollection(name))
  }

  return {
    success: results.every(item => item.status === 'created' || item.status === 'exists'),
    results
  }
}