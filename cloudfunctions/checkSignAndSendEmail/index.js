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
    console.error("❌ SMTP连接失败：", error.message);
  } else {
    console.log("✅ SMTP连接成功");
  }
});

exports.main = async (event, context) => {
  try {
    console.log("📌 签到检查函数开始执行");
    const now = new Date();

    // 1. 查询绑定邮箱的用户
    const emailsRes = await db.collection("emails").get();
    if (emailsRes.data.length === 0) {
      console.log("📭 无绑定邮箱的用户，直接返回");
      return { success: true, msg: "无绑定邮箱的用户" };
    }

    // 整理用户-邮箱映射
    const userEmailMap = {};
    emailsRes.data.forEach((item) => {
      if (item._openid && item.email) {
        if (!userEmailMap[item._openid]) {
          userEmailMap[item._openid] = [];
        }
        userEmailMap[item._openid].push(item.email);
      }
    });
    console.log("🗺️ 整理后的用户-邮箱映射：", userEmailMap);

    // 2. 遍历用户检查签到，计算实际未签到天数
    for (const openid in userEmailMap) {
      const emailList = userEmailMap[openid];
      console.log(`👤 开始处理用户${openid}，邮箱：`, emailList);

      // 查询该用户的所有签到记录，按时间倒序取最近一条
      const signRes = await db
        .collection("signRecords")
        .where({ _openid: openid })
        .orderBy("signTime", "desc")
        .limit(1)
        .get();

      // 计算实际未签到天数（适配当前users集合的lastPayTime字段）
      let actualDays = 0;
      if (signRes.data.length === 0) {
        // 从未签到过：用lastPayTime作为初始时间
        const userRes = await db
          .collection("users")
          .where({ _openid: openid })
          .limit(1)
          .get();
        const initTime =
          userRes.data.length > 0 ? new Date(userRes.data[0].lastPayTime) : now; // 若没有lastPayTime，用当前时间
        actualDays = Math.ceil((now - initTime) / (1000 * 60 * 60 * 24));
      } else {
        // 有签到记录：计算“现在-最后一次签到时间”的天数差
        const lastSignTime = new Date(signRes.data[0].signTime);
        actualDays = Math.ceil((now - lastSignTime) / (1000 * 60 * 60 * 24));
      }
      console.log(`👤 用户${openid}实际未签到天数：${actualDays}天`);

      // 实际未签到天数≥2天才发邮件（可调整阈值）
      if (actualDays >= 2) {
        console.log(`⚠️ 用户${openid}未签到${actualDays}天，准备发邮件`);

        // 获取用户和联系人信息
        const userRes = await db
          .collection("users")
          .where({ _openid: openid })
          .limit(1)
          .get();
        const userName =
          userRes.data.length > 0 ? userRes.data[0].name : "用户";
        const contactRes = await db
          .collection("contacts")
          .where({ _openid: openid })
          .get();
        const contactName =
          contactRes.data.length > 0 ? contactRes.data[0].name : "家人";

        // 发送邮件：显示实际未签到天数
        await transporter.sendMail({
          from: '"咱爸咱妈平安签" <1476069379@qq.com>',
          to: emailList.join(","),
          subject: `紧急提醒：家人连续${actualDays}天未签到`,
          html: `
            <div style="font-size: 14px; line-height: 1.8;">
              <p>尊敬的${contactName}：</p>
              <p>您好！您的家人【${userName}】已连续${actualDays}天未使用「咱爸咱妈平安签」小程序签到，请您尽快联系确认情况。</p>
              <p>若已确认安全，可忽略此提醒；若无法联系，请及时采取措施。</p>
              <p style="margin-top: 20px;">「咱爸咱妈平安签」团队</p>
            </div>
          `,
        });
        console.log(`✅ 用户${openid}的邮件发送成功！`);
      } else {
        console.log(
          `✅ 用户${openid}未签到${actualDays}天，未达提醒阈值，跳过发邮件`,
        );
      }
    }

    return { success: true, msg: "函数执行完成" };
  } catch (err) {
    console.error("❌ 函数执行失败：", err.message);
    return { success: false, msg: "执行失败", error: err.message };
  }
};
