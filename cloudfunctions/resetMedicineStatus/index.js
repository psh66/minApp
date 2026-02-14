// cloudfunctions/resetMedicineStatus/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  try {
    console.log('开始执行每日用药状态重置任务')
    
    // 1. 获取当前时间，确定今日0点的时间戳
    const today = new Date()
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()) // 今日0点
    const yesterdayEnd = todayStart.getTime() - 1 // 昨日23:59:59的时间戳
    
    // 2. 查询所有启用的用药提醒
    const remindRes = await db.collection('medicineRemind')
      .where({ isEnable: true })
      .get()
      
    if (!remindRes.data || remindRes.data.length === 0) {
      console.log('暂无启用的用药提醒，重置任务结束')
      return { success: true, msg: '暂无需要重置的提醒' }
    }
    
    // 3. 批量处理每条提醒的状态
    const resetTasks = []
    for (const remind of remindRes.data) {
      // 3.1 检查该提醒昨日是否有服药记录
      const yesterdayRecordRes = await db.collection('medicineRecord')
        .where({
          remindId: remind._id,
          parentOpenid: remind.parentOpenid,
          createTime: db.command.lte(yesterdayEnd)
        })
        .get()
      
      // 3.2 核心逻辑：仅当昨日有记录、今日无记录时，无需新增；否则标记为未服药
      // （注：这里不修改历史记录，而是通过"今日无记录=未服药"的逻辑实现状态重置）
      // 如需主动标记，可新增一条今日的未服药记录：
      await db.collection('medicineRecord').add({
        data: {
          remindId: remind._id,
          parentOpenid: remind.parentOpenid,
          takeStatus: 'unfinished', // 初始化为未服药
          createTime: db.serverDate(),
          takeTime: null, // 未服药则无服药时间
          remindTime: '',
          delayCount: 0
        }
      })
      resetTasks.push(`提醒${remind.medicineName}已重置为未服药`)
    }
    
    console.log('用药状态重置完成：', resetTasks)
    return {
      success: true,
      msg: `成功重置${resetTasks.length}条用药提醒状态`,
      detail: resetTasks
    }
  } catch (err) {
    console.error('用药状态重置失败：', err)
    return {
      success: false,
      msg: '重置失败',
      error: err.message
    }
  }
}