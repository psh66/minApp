const cloud = require("wx-server-sdk");
const nodemailer = require("nodemailer");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 邮箱配置
const transporter = nodemailer.createTransport({
  host: "smtp.qq.com",
  port: 465,
  secure: true,
  auth: {
    user: "1476069379@qq.com",
    pass: "ksfntxnghwswgjgc",
  },
});

// 验证SMTP连接
transporter.verify((error, success) => {
  if (error) {
    console.error("【SMTP连接】❌ 连接失败：", error.message);
  } else {
    console.log("【SMTP连接】✅ 连接成功");
  }
});

exports.main = async (event, context) => {
  try {
    console.log("===== 【函数启动】签到检查函数开始执行 =====");
    const now = new Date();
    console.log("【函数启动】当前时间：", now.toLocaleString());

    // 1. 查询绑定邮箱的用户
    console.log("【步骤1】开始查询emails集合绑定的用户");
    const emailsRes = await db.collection("emails").get();
    if (emailsRes.data.length === 0) {
      console.log("【步骤1】📭 无绑定邮箱的用户，直接返回");
      return { success: true, msg: "无绑定邮箱的用户" };
    }
    console.log("【步骤1】✅ 查询到绑定邮箱的用户数：", emailsRes.data.length);

    // 整理用户-邮箱映射
    const userEmailMap = {};
    emailsRes.data.forEach((item) => {
      if (item._openid && item.email) {
        if (!userEmailMap[item._openid]) {
          userEmailMap[item._openid] = [];
        }
        userEmailMap[item._openid].push(item.email);
      } else {
        console.log("【步骤1】⚠️ 无效用户记录：", JSON.stringify(item));
      }
    });
    console.log(
      "【步骤1】🗺️ 整理后的用户-邮箱映射：",
      JSON.stringify(userEmailMap),
    );

    // 2. 遍历用户检查签到，计算实际未签到天数
    console.log("【步骤2】开始遍历用户处理邮件提醒逻辑");
    const userIds = Object.keys(userEmailMap);
    console.log("【步骤2】待处理用户总数：", userIds.length);

    for (const openid of userIds) {
      console.log(`\n===== 【用户处理】开始处理用户 openid: ${openid} =====`);
      const emailList = userEmailMap[openid];
      console.log("【用户处理】绑定的邮箱列表：", emailList.join(","));

      // ===== 获取用户信息（含服务到期时间、提醒开关）=====
      console.log("【用户信息】开始查询users集合用户数据");
      const userRes = await db
        .collection("users")
        .where({ _openid: openid })
        .limit(1)
        .get();
      const userData = userRes.data.length > 0 ? userRes.data[0] : {};
      console.log("【用户信息】✅ 查询到用户数据：", JSON.stringify(userData));

      // ========== 核心修复：兼容所有格式的serviceEndTime解析 ==========
      let isExpired = false;
      if (userData.serviceEndTime) {
        let serviceEndTime;
        // 兼容数字时间戳、日期字符串、年-月-日等所有格式
        if (typeof userData.serviceEndTime === 'number') {
          serviceEndTime = new Date(userData.serviceEndTime);
        } else {
          // 字符串格式直接解析，自动兼容2034-09-04、2034-09-04T00:00:00等
          serviceEndTime = new Date(userData.serviceEndTime);
        }
        // 校验解析结果是否有效
        if (!isNaN(serviceEndTime.getTime())) {
          isExpired = serviceEndTime < now;
          console.log("【服务状态】📅 解析到有效到期时间：", serviceEndTime.toLocaleString());
          console.log("【服务状态】⏰ 到期时间是否早于当前：", isExpired ? "是" : "否");
        } else {
          console.log("【服务状态】🚫 serviceEndTime格式无效，判定为到期");
          isExpired = true;
        }
      } else if (userData.isTrialExpired === true) {
        console.log("【服务状态】🚫 isTrialExpired为true，判定为到期");
        isExpired = true;
      } else {
        console.log("【服务状态】🚫 无serviceEndTime，判定为到期");
        isExpired = true;
      }
      console.log("【服务状态】最终到期判定：", isExpired ? "是" : "否");
      if (isExpired) {
        console.log("【服务状态】🚫 服务到期，跳过发邮件");
        continue;
      }

      // 提醒开关判断
      const enableRemind = userData.enableRemind ?? true;
      console.log(
        "【提醒开关】用户enableRemind字段值：",
        userData.enableRemind,
      );
      console.log("【提醒开关】最终判断状态：", enableRemind ? "开启" : "关闭");
      if (!enableRemind) {
        console.log("【提醒开关】🚫 提醒开关已关闭，跳过发邮件");
        continue;
      }

      // ========== 强校验查询最新签到记录（核心）==========
      console.log("【签到记录】开始查询signRecords近30天最新签到记录");
      const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
      const signRes = await db
        .collection("signRecords")
        .where({
          _openid: openid,
          signTime: _.gte(thirtyDaysAgo)
        })
        .orderBy("signTime", "desc")
        .limit(1)
        .get();
      console.log("【签到记录】查询结果：", JSON.stringify(signRes.data));
      // 打印最新签到时间（若有）
      if (signRes.data.length > 0) {
        const latestSignTime = new Date(Number(signRes.data[0].signTime)).toLocaleString();
        console.log("【签到记录】✅ 最新签到时间：", latestSignTime);
      }

      // ========== 时间戳强制转换+有效性校验，计算真实未签到天数 ==========
      let actualDays = 0;
      let initTime = now;
      if (signRes.data.length === 0) {
        console.log("【天数计算】无近30天签到记录，使用付费/服务开始时间计算");
        if (userData.lastPayTime) {
          initTime = new Date(Number(userData.lastPayTime) || userData.lastPayTime);
          if (isNaN(initTime.getTime())) {
            console.log("【天数计算】⚠️ lastPayTime无效，使用当前时间");
            initTime = now;
          }
        } else if (userData.serviceStartTime) {
          initTime = new Date(Number(userData.serviceStartTime) || userData.serviceStartTime);
          if (isNaN(initTime.getTime())) {
            console.log("【天数计算】⚠️ serviceStartTime无效，使用当前时间");
            initTime = now;
          }
        }
        console.log("【天数计算】初始时间：", initTime.toLocaleString());
      } else {
        // 强制转换为数字型时间戳，避免字符串解析错误
        const signTimeNum = Number(signRes.data[0].signTime);
        initTime = new Date(signTimeNum);
        // 校验签到时间有效性
        if (isNaN(initTime.getTime()) || initTime > now) {
          console.log("【天数计算】⚠️ 签到时间无效/晚于当前，使用当前时间");
          initTime = now;
        }
      }
      // 计算真实天数差，向上取整
      const timeDiff = now - initTime;
      actualDays = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
      // 仅保证天数非负，无任何上限限制
      actualDays = Math.max(0, actualDays);
      console.log("【天数计算】时间差(毫秒)：", timeDiff);
      console.log("【天数计算】✅ 实际未签到天数：", actualDays);

      // 开关切换适配：关闭后重新打开，重置lastRemindDays为0
      let lastRemindDays = userData.lastRemindDays || 0;
      console.log("【历史记录】上次提醒天数lastRemindDays：", lastRemindDays);
      const wasRemindDisabled = userData.enableRemind === false && enableRemind === true;
      if (wasRemindDisabled) {
        console.log("【开关切换】⚠️ 开关从关闭切开启，重置lastRemindDays为0");
        await db.collection("users").where({ _openid: openid }).update({
          data: { lastRemindDays: 0 },
        });
        lastRemindDays = 0;
        console.log("【开关切换】✅ lastRemindDays已重置");
      }

      // ========== 最终发送条件：仅≥2天未签到时触发邮件+更新字段 ==========
      console.log("【发送条件】校验：未签到天数≥2天？", actualDays >= 2 ? "是" : "否");
      if (actualDays >= 2) {
        // 新增：打印待发送邮件的用户完整列表信息（核心需求）
        console.log(
          "【待发送邮件用户】📧 信息汇总：",
          JSON.stringify({
            userOpenid: openid,
            userName: userData.name || "未知用户",
            unSignDays: actualDays,
            bindEmails: emailList,
            remindTime: now.toLocaleString()
          }, null, 2)
        );
        console.log(`【发送准备】⚠️ 满足条件，发送${actualDays}天未签到提醒邮件`);

        // 获取用户和联系人信息
        const userName = userData.name || "用户";
        const contactRes = await db.collection("contacts").where({ _openid: openid }).get();
        const contactName = contactRes.data.length > 0 ? contactRes.data[0].name : "家人";
        console.log("【邮件内容】用户：", userName, "，联系人：", contactName);

        // 发送邮件（标题/内容均显示实际未签到天数）
        try {
          await transporter.sendMail({
            from: '"咱爸咱妈平安签" <1476069379@qq.com>',
            to: emailList.join(","),
            subject: `紧急提醒：家人连续${actualDays}天未签到`,
            html: `
              <div style="font-size: 14px; line-height: 1.8;">
                <p>尊敬的${contactName}：</p>
                <p>您好！您的家人【${userName}】已连续${actualDays}天未使用「咱爸咱妈平安签」小程序签到，请您尽快联系确认情况。</p>
                <p>若已确认家人安全，可忽略此提醒；若暂时无法联系，请及时采取必要措施。</p>
                <p style="margin-top: 20px; color: #666;">「咱爸咱妈平安签」团队</p>
              </div>
            `,
          });
          console.log("【邮件发送】✅ 邮件发送成功！");

          // 更新lastRemindDays为当前实际未签到天数，同步数据
          await db.collection("users").where({ _openid: openid }).update({
            data: { lastRemindDays: actualDays },
          });
          console.log("【记录更新】✅ lastRemindDays已更新为实际天数：", actualDays);
        } catch (emailErr) {
          console.error("【邮件发送】❌ 邮件发送失败：", emailErr.message);
        }
      } else {
        console.log("【发送条件】❌ 未签到天数不足2天，跳过发邮件+更新字段");
      }
      console.log(`===== 【用户处理】结束处理用户 openid: ${openid} =====\n`);
    }

    console.log("===== 【函数结束】签到检查函数执行完成 =====");
    return { success: true, msg: "函数执行完成" };
  } catch (err) {
    console.error("===== 【函数异常】❌ 执行失败 =====", err.message);
    console.error("【异常堆栈】", err.stack);
    return { success: false, msg: "执行失败", error: err.message };
  }
};