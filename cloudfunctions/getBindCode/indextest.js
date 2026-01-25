// cloudfunctions/getBindCode/index.js
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  // 生成6位随机数字绑定码
  const bindCode = Math.floor(Math.random() * 900000 + 100000).toString()
  try {
    await db.collection('user').doc(openid).update({
      data: { bindCode, createTime: db.serverDate() }
    })
    return { success: true, bindCode }
  } catch (err) {
    return { success: false, errMsg: err.message }
  }
}
// cloudfunctions/checkBindCode/index.js
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database()

exports.main = async (event, context) => {
  const { bindCode } = event
  try {
    const res = await db.collection('user').where({ bindCode }).get()
    if (res.data.length === 0) {
      return { success: false, errMsg: '绑定码无效' }
    }
    return { success: true, parentOpenid: res.data[0]._openid }
  } catch (err) {
    return { success: false, errMsg: err.message }
  }
}