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
    // 新增：关怀模式相关字段
    careMode: false, // 关怀模式开关，默认关闭
    fontSizeMultiple: 1.0, // 字体倍数，默认1.0（原大小）
    // 字体选项（下拉选择：1.1~2.0倍）
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
    currentFontIndex: 0, // 默认选中第一个选项
  },

  onLoad() {
    // 优先加载完整的用户数据（包含所有设置的字段）
    this.loadAllUserData();
    // 读取本地缓存的关怀模式设置
    this.loadCareModeSetting();
  },

  // 读取关怀模式本地缓存
  loadCareModeSetting() {
    try {
      const careMode = wx.getStorageSync("careMode") || false;
      let fontSizeMultiple = wx.getStorageSync("fontSizeMultiple") || 1.1; // 默认1.1倍
      // 确保倍数在1.1~2.0范围内
      fontSizeMultiple = Math.max(1.1, Math.min(2.0, fontSizeMultiple));
      // 匹配对应的下拉索引（关键修复）
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

  // 关怀模式开关切换（关闭时自动还原字体为1.0）
  onCareModeSwitchChange(e) {
    const careMode = e.detail.value;
    // 关闭关怀模式时，强制将字体还原为1.0
    const fontSizeMultiple = careMode
      ? this.data.fontOptions[this.data.currentFontIndex].value
      : 1.0;
    this.setData({
      careMode,
      fontSizeMultiple,
    });
    // 保存到本地缓存
    wx.setStorageSync("careMode", careMode);
    wx.setStorageSync("fontSizeMultiple", fontSizeMultiple);
    // 提示
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
    // 保存到本地缓存
    wx.setStorageSync("fontSizeMultiple", selectedFont.value);
  },

  // 原有方法：加载用户数据（统一剩余天数计算逻辑）
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
        // 统一到期日计算：优先取数据库的serviceEndTime，无则用创建时间+3天
        const trialEndTime = new Date(
          userData.serviceEndTime ||
            (() => {
              const temp = new Date(createTime);
              temp.setDate(temp.getDate() + 3);
              return temp;
            })(),
        );
        const now = new Date();
        // 统一剩余天数计算：不足1天则为0
        const remainingDays = isFormal
          ? 0
          : Math.max(
              0,
              Math.ceil((trialEndTime - now) / (1000 * 60 * 60 * 24)),
            );

        const userInfo = {
          name: userData.name || "",
          homeLocation: userData.homeLocation || null,
          enableRemind: userData.enableRemind ?? true,
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

  // 原有方法：日期格式化（无修改）
  formatDate(date) {
    date = new Date(date);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

  // 原有方法：签到提醒开关（无修改）
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

      this.setData({ "userInfo.enableRemind": enableRemind });
      wx.showToast({ title: enableRemind ? "提醒已开启" : "提醒已关闭" });
    } catch (err) {
      console.error("修改提醒状态失败：", err);
      wx.showToast({ title: "修改失败，请重试", icon: "none" });
    }
  },

  // 原有支付相关方法（无修改）
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

      this.loadAllUserData();
    } catch (err) {
      console.error("更新版本失败：", err);
      wx.showToast({ title: "版本更新失败，请联系客服", icon: "none" });
    }
  },

  // 原有关于弹窗方法（无修改）
  showAboutDialog() {
    this.setData({ showAtDialog: true });
  },
  closeAboutDialog() {
    this.setData({ showAtDialog: false });
  },

  // 原有页面显示方法（无修改）
  onShow() {
    this.loadAllUserData();
    // 重新读取关怀模式设置，确保切换页面后生效
    this.loadCareModeSetting();
  },
});
