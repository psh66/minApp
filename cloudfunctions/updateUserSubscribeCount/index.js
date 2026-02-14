// 云函数入口文件（index.js）
const cloud = require('wx-server-sdk')

// 初始化云环境（DYNAMIC_CURRENT_ENV 表示使用当前小程序绑定的环境）
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// 获取数据库引用
const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  try {
    // 1. 接收前端传递的参数
    const { openid, tmplId, increment } = event
    
    // 校验必要参数（防止空值导致报错）
    if (!openid || !tmplId || increment === undefined) {
      return {
        success: false,
        msg: '参数缺失：openid、tmplId、increment 为必传项'
      }
    }

    // 2. 查询 userSubscribe 集合中是否已有该用户的该模板记录
    const queryRes = await db.collection('userSubscribe')
      .where({
        openid: openid,    // 用户openid（父母/自己）
        tmplId: tmplId     // 订阅消息模板ID
      })
      .get()

    // 3. 有记录 → 更新次数；无记录 → 新增记录
    if (queryRes.data.length > 0) {
      // 已有记录：更新剩余次数（inc 是原子操作，避免并发问题）
      await db.collection('userSubscribe')
        .doc(queryRes.data[0]._id)  // 用记录ID更新，更高效
        .update({
          data: {
            remainCount: db.command.inc(increment),  // +1 或 -1
            updateTime: db.serverDate()              // 服务器时间，避免前端时间不准
          }
        })
    } else {
      // 无记录：新增订阅次数记录
      await db.collection('userSubscribe')
        .add({
          data: {
            openid: openid,
            tmplId: tmplId,
            remainCount: increment,  // 初始次数（比如授权成功就是1）
            createTime: db.serverDate(),
            updateTime: db.serverDate()
          }
        })
    }

    // 4. 返回成功结果
    return {
      success: true,
      msg: '订阅次数更新成功'
    }

  } catch (err) {
    // 捕获异常并返回错误信息（方便前端排查）
    console.error('更新订阅次数失败：', err)
    return {
      success: false,
      msg: `操作失败：${err.message || '未知错误'}`,
      error: err
    }
  }
}