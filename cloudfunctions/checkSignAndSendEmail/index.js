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

      // ========== 修复：强化服务到期判断（核心改动） ==========
      // 新增：兜底判断 - 只要是试用到期/服务到期，直接跳过
      let isExpired = false;
      // 判断1：有serviceEndTime且解析有效
      if (userData.serviceEndTime) {
        const serviceEndTime = new Date(userData.serviceEndTime);
        // 校验日期是否有效
        if (!isNaN(serviceEndTime.getTime())) {
          isExpired = serviceEndTime < now;
        } else {
          console.log("【服务状态】🚫 serviceEndTime格式无效，判定为到期");
          isExpired = true; // 格式无效直接判定为到期
        }
      }
      // 判断2：有isTrialExpired字段且为true（前端同步的到期标识）
      else if (userData.isTrialExpired === true) {
        console.log("【服务状态】🚫 isTrialExpired为true，判定为到期");
        isExpired = true;
      }
      // 判断3：无服务到期时间，直接判定为到期
      else {
        console.log("【服务状态】🚫 无serviceEndTime，判定为到期");
        isExpired = true;
      }

      // 最终判定：到期则跳过
      console.log("【服务状态】最终到期判定：", isExpired ? "是" : "否");
      if (isExpired) {
        console.log("【服务状态】🚫 服务到期，跳过发邮件");
        continue;
      }
      // ========== 修复结束 ==========

      // 关键判断2：提醒开关关闭 → 跳过（无字段视为开启）
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

      // 查询最近一次签到记录
      console.log("【签到记录】开始查询signRecords集合最近签到记录");
      const signRes = await db
        .collection("signRecords")
        .where({ _openid: openid })
        .orderBy("signTime", "desc")
        .limit(1)
        .get();
      console.log("【签到记录】查询结果：", JSON.stringify(signRes.data));

      // 计算实际未签到天数（适配lastPayTime/serviceStartTime）
      let actualDays = 0;
      let initTime = now;
      if (signRes.data.length === 0) {
        console.log("【天数计算】用户无签到记录，使用付费/服务开始时间计算");
        if (userData.lastPayTime) {
          initTime = new Date(userData.lastPayTime);
          console.log(
            "【天数计算】使用lastPayTime作为初始时间：",
            initTime.toLocaleString(),
          );
        } else if (userData.serviceStartTime) {
          initTime = new Date(userData.serviceStartTime);
          console.log(
            "【天数计算】使用serviceStartTime作为初始时间：",
            initTime.toLocaleString(),
          );
        } else {
          console.log(
            "【天数计算】无lastPayTime和serviceStartTime，使用当前时间作为初始时间",
          );
        }
      } else {
        initTime = new Date(signRes.data[0].signTime);
        console.log(
          "【天数计算】用户最后签到时间：",
          initTime.toLocaleString(),
        );
      }
      // 计算天数差
      const timeDiff = now - initTime;
      actualDays = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
      console.log("【天数计算】时间差(毫秒)：", timeDiff);
      console.log("【天数计算】✅ 实际未签到天数：", actualDays);

      // ===== 关闭后重新打开适配 =====
      let lastRemindDays = userData.lastRemindDays || 0;
      console.log(
        "【历史记录】用户上次提醒天数lastRemindDays：",
        lastRemindDays,
      );
      const wasRemindDisabled =
        userData.enableRemind === false && enableRemind === true;
      if (wasRemindDisabled) {
        console.log(
          "【开关切换】⚠️ 用户刚从关闭切换为开启，重置lastRemindDays为0",
        );
        await db
          .collection("users")
          .where({ _openid: openid })
          .update({
            data: { lastRemindDays: 0 },
          });
        lastRemindDays = 0;
        console.log("【开关切换】✅ lastRemindDays已重置为0");
      }

      // 发送条件校验
      console.log(
        "【发送条件】校验：未签到天数≥2天？",
        actualDays >= 2 ? "是" : "否",
      );
      console.log(
        "【发送条件】校验：当前天数>上次提醒天数？",
        actualDays > lastRemindDays ? "是" : "否",
      );
      if (actualDays >= 2 && actualDays > lastRemindDays) {
        console.log(
          `【发送准备】⚠️ 满足所有条件，准备发送${actualDays}天未签到提醒邮件`,
        );

        // 获取用户和联系人信息
        const userName = userData.name || "用户";
        console.log("【邮件内容】用户昵称：", userName);
        console.log("【邮件内容】开始查询contacts集合联系人信息");
        const contactRes = await db
          .collection("contacts")
          .where({ _openid: openid })
          .get();
        const contactName =
          contactRes.data.length > 0 ? contactRes.data[0].name : "家人";
        console.log("【邮件内容】联系人名称：", contactName);

        // 发送邮件
        try {
          console.log("【邮件发送】开始发送邮件到：", emailList.join(","));
          await transporter.sendMail({
            from: '"咱爸咱妈平安签" <1476069379@qq.com>',
            to: emailList.join(","),
            subject: `紧急提醒：家人连续${actualDays}天未签到`,
            html: `
              <div style="font-size: 14px; line-height: 1.8;">
                <p>尊敬的${contactName}：</p >
                <p>您好！您的家人【${userName}】已连续${actualDays}天未使用「咱爸咱妈平安签」小程序签到，请您尽快联系确认情况。</p >
                <p>若已确认安全，可忽略此提醒；若无法联系，请及时采取措施。</p >
                <p style="margin-top: 20px;">「咱爸咱妈平安签」团队</p >
              </div>
            `,
          });
          console.log("【邮件发送】✅ 邮件发送成功！");

          // 更新上次提醒天数（仅用于判断天数递增）
          console.log("【记录更新】开始更新lastRemindDays为：", actualDays);
          await db
            .collection("users")
            .where({ _openid: openid })
            .update({
              data: { lastRemindDays: actualDays },
            });
          console.log("【记录更新】✅ lastRemindDays更新成功");
        } catch (emailErr) {
          console.error("【邮件发送】❌ 邮件发送失败：", emailErr.message);
        }
      } else {
        console.log("【发送条件】❌ 未满足发送条件，跳过发邮件");
      }
      console.log(`===== 【用户处理】结束处理用户 openid: ${openid} =====\n`);
    }

    console.log("===== 【函数结束】签到检查函数执行完成 =====");
    return { success: true, msg: "函数执行完成" };
  } catch (err) {
    console.error("===== 【函数异常】❌ 函数执行失败 =====", err.message);
    console.error("【异常堆栈】", err.stack);
    return { success: false, msg: "执行失败", error: err.message };
  }
};
