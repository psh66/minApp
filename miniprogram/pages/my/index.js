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
    showAboutDialog: false, // 修复：变量名统一
    // 用户核心信息
    userInfo: {
      name: "",
      homeLocation: null,
      enableRemind: true,
    },
    // 关怀模式相关
    careMode: false,
    fontSizeMultiple: 1.0,
    fontOptions: [
      { name: "1.1倍", value: 1.1 },
      { name: "1.2倍", value: 1.2 },
      { name: "1.3倍", value: 1.3 },
      { name: "1.4倍", value: 1.4 },
      { name: "1.5倍", value: 1.5 },
      { name: "1.6倍", value: 1.6 },
      { name: "1.8倍", value: 1.8 },
      { name: "2.0倍", value: 2.0 },
    ],
    currentFontIndex: 0,
  },

  onLoad() {
    this.loadAllUserData();
    this.loadCareModeSetting();
  },

  // 读取关怀模式本地缓存
  loadCareModeSetting() {
    try {
      const careMode = wx.getStorageSync("careMode") || false;
      let fontSizeMultiple = wx.getStorageSync("fontSizeMultiple") || 1.1;
      fontSizeMultiple = Math.max(1.1, Math.min(2.0, fontSizeMultiple));
      const currentFontIndex =
        this.data.fontOptions.findIndex(
          (item) => item.value === fontSizeMultiple,
        ) || 0;
      this.setData({
        careMode,
        fontSizeMultiple,
        currentFontIndex,
      });
    } catch (err) {
      console.error("读取关怀模式设置失败：", err);
    }
  },

  // 关怀模式开关切换
  onCareModeSwitchChange(e) {
    const careMode = e.detail.value;
    const fontSizeMultiple = careMode
      ? this.data.fontOptions[this.data.currentFontIndex].value
      : 1.0;
    this.setData({
      careMode,
      fontSizeMultiple,
    });
    wx.setStorageSync("careMode", careMode);
    wx.setStorageSync("fontSizeMultiple", fontSizeMultiple);
    wx.showToast({
      title: careMode ? "已开启关怀模式" : "已关闭关怀模式（字体已还原）",
      icon: "none",
    });
  },

  // 字体下拉选项切换
  onFontChange(e) {
    const index = e.detail.value;
    const selectedFont = this.data.fontOptions[index];
    this.setData({
      currentFontIndex: index,
      fontSizeMultiple: selectedFont.value,
    });
    wx.setStorageSync("fontSizeMultiple", selectedFont.value);
  },

  // 加载用户数据（修复：到期自动关闭提醒）
  async loadAllUserData() {
    try {
      const app = getApp();
      const res = await usersCol
        .where({ _openid: app.globalData.openid })
        .get();

      if (res.data.length > 0) {
        const userData = res.data[0];
        const createTime = userData.createTime
          ? new Date(userData.createTime)
          : new Date();
        const isFormal = userData.isFormalVersion || false;
        const trialEndTime = new Date(
          userData.serviceEndTime ||
            (() => {
              const temp = new Date(createTime);
              temp.setDate(temp.getDate() + 3);
              return temp;
            })(),
        );
        const now = new Date();
        const remainingDays = isFormal
          ? 0
          : Math.max(
              0,
              Math.ceil((trialEndTime - now) / (1000 * 60 * 60 * 24)),
            );

        // 修复：服务到期时自动关闭提醒
        const userInfo = {
          name: userData.name || "",
          homeLocation: userData.homeLocation || null,
          enableRemind: this.data.isTrialExpired
            ? false
            : (userData.enableRemind ?? true),
        };

        this.setData({
          isFormalVersion: isFormal,
          remainingTrialDays: remainingDays,
          serviceStartTime:
            userData.serviceStartTime || this.formatDate(createTime),
          serviceEndTime: this.formatDate(trialEndTime),
          isTrialExpired: !isFormal && now > trialEndTime,
          userInfo: userInfo,
        });

        if (this.data.isTrialExpired) {
          wx.showModal({
            title: "试用已到期",
            content: "您的3天试用已结束，升级正式版后可继续使用全部功能",
            showCancel: false,
            success: () => this.showPayDialog(),
          });
        }
      } else {
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

  // 日期格式化
  formatDate(date) {
    date = new Date(date);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

  // 签到提醒开关（修复：到期禁用）
  async onRemindSwitchChange(e) {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "服务已到期，无法修改提醒", icon: "none" });
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

      this.setData({ "userInfo.enableRemind": enableRemind });
      wx.showToast({ title: enableRemind ? "提醒已开启" : "提醒已关闭" });
    } catch (err) {
      console.error("修改提醒状态失败：", err);
      wx.showToast({ title: "修改失败，请重试", icon: "none" });
    }
  },

  // 支付弹窗
  showPayDialog() {
    this.setData({ showPayDialog: true });
  },
  closePayDialog() {
    this.setData({ showPayDialog: false });
  },

  // 选择支付类型
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
            // 修复：区分升级/续费提示
            const toastTitle = this.data.isFormalVersion
              ? "续费成功，服务已延长"
              : "升级成功，已开通正式版";
            wx.showToast({ title: toastTitle });
            this.closePayDialog();
            // 新增：支付成功后立即刷新数据
            this.loadAllUserData();
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

  // 核心修改：区分试用是否过期，不同规则计算有效期
  async updateUserVersion(payType) {
    try {
      const app = getApp();
      const now = new Date();
      const userRes = await usersCol
        .where({ _openid: app.globalData.openid })
        .get();

      let currentServiceEnd;
      if (userRes.data.length > 0) {
        // 有用户记录时，判断试用是否过期
        const userData = userRes.data[0];
        const trialEndTime = new Date(userData.serviceEndTime);
        // 未过期：用原结束时间；已过期：用当前时间
        currentServiceEnd = this.data.isTrialExpired ? now : trialEndTime;
      } else {
        // 无用户记录，用当前时间
        currentServiceEnd = now;
      }

      // 计算新的结束时间
      let serviceEndTime = new Date(currentServiceEnd);
      if (payType === "month") {
        serviceEndTime.setDate(serviceEndTime.getDate() + 30);
      } else {
        serviceEndTime.setFullYear(serviceEndTime.getFullYear() + 1);
      }

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

      this.loadAllUserData();
    } catch (err) {
      console.error("更新版本失败：", err);
      wx.showToast({ title: "版本更新失败，请联系客服", icon: "none" });
    }
  },

  // 关于弹窗
  showAboutDialog() {
    this.setData({ showAboutDialog: true });
  },
  closeAboutDialog() {
    this.setData({ showAboutDialog: false });
  },

  // 分享
  onShareAppMessage() {
    return {
      title: "咱爸咱妈平安签，守护家人安全",
      path: "/pages/index/index",
      imageUrl: "../../images/001.jpg",
    };
  },
  onShareTimeline() {
    return {
      title: "咱爸咱妈平安签，守护家人安全",
      imageUrl: "../../images/001.jpg",
    };
  },

  onShow() {
    this.loadAllUserData();
    this.loadCareModeSetting();
  },
});
