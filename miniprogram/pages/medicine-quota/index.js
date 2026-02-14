const app = getApp();
const db = wx.cloud.database();
// 模板ID和云函数保持一致
const TEMPLATE_ID = "TTh86bIvpQrQjBZ2OSOcw4onxCo0Eey4wjTAtoXNl-E";

Page({
  data: {
    tmplId: TEMPLATE_ID, // 替换为真实模板ID
    noticeName: "用药提醒通知",
    desc: "所有用户共用总次数，推送一次扣一次",
    enabled: true, // 推送开关状态
    totalCount: 0,
    usedCount: 0,
    remainCount: 0,
  },

  onLoad() {
    this.loadQuota();
    this.loadPushSwitch(); // 新增：加载推送开关状态
  },

  // 加载全局次数（优化异常处理）
  async loadQuota() {
    try {
      const { tmplId } = this.data;
      const res = await db
        .collection("globalSubscribeQuota")
        .where({ tmplId })
        .get();
      if (res.data.length > 0) {
        const { totalCount = 0, usedCount = 0 } = res.data[0];
        this.setData({
          totalCount,
          usedCount,
          remainCount: totalCount - usedCount,
        });
      }
    } catch (err) {
      console.error("加载次数失败：", err);
      wx.showToast({ title: "加载次数失败", icon: "none" });
    }
  },

  // 新增：加载推送开关状态（存储到数据库）
  async loadPushSwitch() {
    try {
      const res = await db
        .collection("globalConfig")
        .where({ key: "pushEnabled" })
        .get();
      if (res.data.length > 0) {
        this.setData({ enabled: res.data[0].value });
      }
    } catch (err) {
      console.error("加载开关状态失败：", err);
    }
  },

  // 点击增加一次总次数（优化异常处理+批量增加）
  async addCount() {
    // 可选：改为批量增加（比如一次加10次，更实用）
    const addNum = 1; // 可改为10/50等
    wx.showLoading({ title: `增加${addNum}次中...` });

    try {
      const { tmplId } = this.data;
      const quotaRes = await db
        .collection("globalSubscribeQuota")
        .where({ tmplId })
        .get();

      if (quotaRes.data.length > 0) {
        await db
          .collection("globalSubscribeQuota")
          .doc(quotaRes.data[0]._id)
          .update({
            data: {
              totalCount: db.command.inc(addNum),
              updateTime: db.serverDate(), // 新增：记录更新时间
            },
          });
      } else {
        await db.collection("globalSubscribeQuota").add({
          data: {
            tmplId,
            name: this.data.noticeName,
            totalCount: addNum,
            usedCount: 0,
            updateTime: db.serverDate(),
          },
        });
      }

      wx.hideLoading();
      wx.showToast({ title: `成功增加${addNum}次` });
      this.loadQuota();
    } catch (err) {
      wx.hideLoading();
      console.error("增加次数失败：", err);
      wx.showToast({ title: "增加失败，请重试", icon: "none" });
    }
  },

  // 开关切换（新增：保存开关状态到数据库）
  async onSwitchChange(e) {
    const enabled = e.detail.value;
    this.setData({ enabled });

    try {
      // 保存开关状态到全局配置集合
      const res = await db
        .collection("globalConfig")
        .where({ key: "pushEnabled" })
        .get();

      if (res.data.length > 0) {
        await db
          .collection("globalConfig")
          .doc(res.data[0]._id)
          .update({ data: { value: enabled, updateTime: db.serverDate() } });
      } else {
        await db.collection("globalConfig").add({
          data: {
            key: "pushEnabled",
            value: enabled,
            name: "推送总开关",
            updateTime: db.serverDate(),
          },
        });
      }

      wx.showToast({
        title: enabled ? "已开启推送" : "已关闭推送",
        icon: "success",
      });
    } catch (err) {
      console.error("保存开关状态失败：", err);
      wx.showToast({ title: "操作失败", icon: "none" });
    }
  },

  // 可选：重置已用次数（管理员专用）
  async resetUsedCount() {
    wx.showModal({
      title: "确认重置",
      content: "是否重置已消耗次数为0？",
      async success(res) {
        if (res.confirm) {
          try {
            const quotaRes = await db
              .collection("globalSubscribeQuota")
              .where({ tmplId: TEMPLATE_ID })
              .get();

            if (quotaRes.data.length > 0) {
              await db
                .collection("globalSubscribeQuota")
                .doc(quotaRes.data[0]._id)
                .update({
                  data: { usedCount: 0, updateTime: db.serverDate() },
                });
              wx.showToast({ title: "重置成功" });
              this.loadQuota();
            }
          } catch (err) {
            console.error("重置失败：", err);
            wx.showToast({ title: "重置失败", icon: "none" });
          }
        }
      },
    });
  },
});
