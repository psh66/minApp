const db = wx.cloud.database();
const usersCol = db.collection("users");

Page({
  data: {
    // 版本相关字段（和首页一致）
    isFormalVersion: false,
    remainingTrialDays: 3,
    isTrialExpired: false,
    serviceStartTime: "",
    serviceEndTime: "",
    showPayDialog: false,
    showAtDialog: false,
    // 用户核心信息（确保和数据库字段一致）
    userInfo: {
      name: "", // 用户设置的姓名
      homeLocation: null, // 用户设置的家庭位置
      enableRemind: true, // 签到提醒开关
    },
  },

  onLoad() {
    // 优先加载完整的用户数据（包含所有设置的字段）
    this.loadAllUserData();
  },

  // 新增：统一加载用户所有数据（版本+个人信息），避免字段覆盖
  async loadAllUserData() {
    try {
      const app = getApp();
      // 一次性从usersCol获取用户完整数据
      const res = await usersCol
        .where({ _openid: app.globalData.openid })
        .get();

      if (res.data.length > 0) {
        const userData = res.data[0];
        // 1. 处理版本相关数据
        const createTime = userData.createTime
          ? new Date(userData.createTime)
          : new Date();
        const isFormal = userData.isFormalVersion || false;
        const trialEndTime = new Date(createTime);
        trialEndTime.setDate(trialEndTime.getDate() + 3);
        const remainingDays = isFormal
          ? 0
          : Math.ceil((trialEndTime - new Date()) / (1000 * 60 * 60 * 24));

        // 2. 处理用户设置的核心数据（确保拿到所有字段）
        const userInfo = {
          name: userData.name || "", // 拿到用户设置的姓名
          homeLocation: userData.homeLocation || null, // 拿到用户设置的家庭位置
          enableRemind: userData.enableRemind ?? true, // 拿到提醒开关状态
        };

        // 3. 统一更新页面数据（避免覆盖）
        this.setData({
          isFormalVersion: isFormal,
          remainingTrialDays: remainingDays > 0 ? remainingDays : 0,
          serviceStartTime:
            userData.serviceStartTime || this.formatDate(createTime),
          serviceEndTime:
            userData.serviceEndTime || this.formatDate(trialEndTime),
          isTrialExpired:
            !isFormal &&
            new Date() > new Date(userData.serviceEndTime || trialEndTime),
          userInfo: userInfo, // 关键：完整赋值用户设置的信息
        });

        // 试用到期提示（仅首次加载）
        if (this.data.isTrialExpired) {
          wx.showModal({
            title: "试用已到期",
            content: "您的3天试用已结束，升级正式版后可继续使用全部功能",
            showCancel: false,
            success: () => this.showPayDialog(),
          });
        }
      } else {
        // 新用户默认值（确保字段不缺失）
        const now = new Date();
        const trialEndTime = new Date(now);
        trialEndTime.setDate(trialEndTime.getDate() + 3);
        this.setData({
          serviceStartTime: this.formatDate(now),
          serviceEndTime: this.formatDate(trialEndTime),
          remainingTrialDays: 3,
          isFormalVersion: false,
          isTrialExpired: false,
          userInfo: { name: "", homeLocation: null, enableRemind: true },
        });
      }
    } catch (err) {
      console.error("加载用户数据失败：", err);
      wx.showToast({ title: "加载数据失败，请重试", icon: "none" });
    }
  },

  // 日期格式化（通用方法）
  formatDate(date) {
    date = new Date(date);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

  // 签到提醒开关（确保修改后数据同步）
  async onRemindSwitchChange(e) {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，无法修改", icon: "none" });
    }

    const enableRemind = e.detail.value;
    try {
      const app = getApp();
      const res = await usersCol
        .where({ _openid: app.globalData.openid })
        .get();

      if (res.data.length > 0) {
        await usersCol.doc(res.data[0]._id).update({ data: { enableRemind } });
      } else {
        await usersCol.add({
          data: {
            _openid: app.globalData.openid,
            enableRemind,
            createTime: db.serverDate(),
          },
        });
      }

      // 实时更新页面数据（避免刷新后才显示）
      this.setData({ "userInfo.enableRemind": enableRemind });
      wx.showToast({ title: enableRemind ? "提醒已开启" : "提醒已关闭" });
    } catch (err) {
      console.error("修改提醒状态失败：", err);
      wx.showToast({ title: "修改失败，请重试", icon: "none" });
    }
  },

  // 支付相关方法（保留，确保逻辑不变）
  showPayDialog() {
    this.setData({ showPayDialog: true });
  },
  closePayDialog() {
    this.setData({ showPayDialog: false });
  },
  async choosePayType(e) {
    const type = e.currentTarget.dataset.type;
    const amount = type === "month" ? 3 : 20;

    try {
      wx.showLoading({ title: "创建订单中..." });
      const app = getApp();
      const res = await wx.cloud.callFunction({
        name: "createPayOrder",
        data: { openid: app.globalData.openid, payType: type, amount },
      });
      wx.hideLoading();

      if (res.result?.success) {
        const payParams = res.result.payParams;
        wx.requestPayment({
          ...payParams,
          success: async () => {
            await this.updateUserVersion(type);
            wx.showToast({ title: "支付成功，已升级为正式版" });
            this.closePayDialog();
          },
          fail: (payErr) => {
            console.error("支付请求失败：", payErr);
            wx.showToast({
              title: payErr.errMsg.includes("cancel")
                ? "已取消支付"
                : "支付失败",
              icon: "none",
            });
          },
        });
      } else {
        wx.showToast({
          title: `创建订单失败：${res.result?.msg || "未知错误"}`,
          icon: "none",
          duration: 3000,
        });
      }
    } catch (err) {
      wx.hideLoading();
      console.error("支付失败：", err);
      wx.showToast({ title: "支付异常，请重试", icon: "none" });
    }
  },
  async updateUserVersion(payType) {
    try {
      const app = getApp();
      const now = new Date();
      let serviceEndTime = new Date(now);

      if (payType === "month") {
        serviceEndTime.setDate(serviceEndTime.getDate() + 30);
      } else {
        serviceEndTime.setFullYear(serviceEndTime.getFullYear() + 1);
      }

      const userRes = await usersCol
        .where({ _openid: app.globalData.openid })
        .get();
      const updateData = {
        isFormalVersion: true,
        serviceStartTime: this.formatDate(now),
        serviceEndTime: this.formatDate(serviceEndTime),
        payType,
        lastPayTime: db.serverDate(),
        trialExpired: false,
      };

      if (userRes.data.length > 0) {
        await usersCol.doc(userRes.data[0]._id).update({ data: updateData });
      } else {
        await usersCol.add({
          data: {
            _openid: app.globalData.openid,
            ...updateData,
            createTime: db.serverDate(),
          },
        });
      }

      // 支付成功后重新加载所有数据（确保页面实时更新）
      this.loadAllUserData();
    } catch (err) {
      console.error("更新版本失败：", err);
      wx.showToast({ title: "版本更新失败，请联系客服", icon: "none" });
    }
  },

  // 关于我们弹窗（保留原功能）
  showAboutDialog() {
    this.setData({ showAtDialog: true });
  },
  closeAboutDialog() {
    this.setData({ showAtDialog: false });
  },

  // 页面重新显示时，刷新数据（关键：用户在首页设置后，返回我的页面能看到最新数据）
  onShow() {
    this.loadAllUserData();
  },
});
