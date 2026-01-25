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

    // ========== 子女模式核心字段（新增） ==========
    isChildMode: false, 
    showModeSwitchSheet: false, // 模式切换弹窗
    bindCode: "", // 父母绑定码
    bindParentInfo: {}, // 绑定的父母信息
    isParentPay: false, // 是否为父母支付
    parentPayInfo: {} // 父母支付信息
  },

  onLoad() {
    this.loadAllUserData();
    this.loadCareModeSetting();
    // 同步全局子女模式状态
    const app = getApp();
    this.setData({
      isChildMode: app.globalData.currentMode === "child",
      bindParentInfo: app.globalData.bindParentInfo || {}
    });
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
      // 子女模式下加载父母数据，父母模式下加载自己数据
      const targetOpenid = this.data.isChildMode 
        ? app.globalData.bindParentOpenid 
        : app.globalData.openid;

      if (this.data.isChildMode && !targetOpenid) {
        // 子女模式但未绑定父母，直接返回
        return;
      }

      const res = await usersCol
        .where({ _openid: targetOpenid })
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

        if (this.data.isTrialExpired && !this.data.isChildMode) {
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
    this.setData({ showPayDialog: true, isParentPay: false });
  },
  closePayDialog() {
    this.setData({ showPayDialog: false, isParentPay: false });
  },

  // ========== 子女端特有：打开父母支付弹窗（新增） ==========
  showParentPayDialog() {
    const app = getApp();
    if (!app.globalData.bindParentOpenid) {
      return wx.showToast({ title: "未绑定父母账号", icon: "none" });
    }
    // 拉取父母的账号状态（试用/正式/到期）
    db.collection("users")
      .where({ _openid: app.globalData.bindParentOpenid })
      .get().then(res => {
        if (res.data.length === 0) {
          return wx.showToast({ title: "父母账号未注册", icon: "none" });
        }
        const parentInfo = res.data[0];
        this.setData({
          showPayDialog: true,
          parentPayInfo: parentInfo,
          isParentPay: true
        });
      }).catch(err => {
        console.error("拉取父母账号状态失败：", err);
        wx.showToast({ title: "获取父母信息失败", icon: "none" });
      });
  },

  // 选择支付类型（适配子女端为父母支付）
  async choosePayType(e) {
    const type = e.currentTarget.dataset.type;
    const amount = type === "month" ? 3 : 20;
    const app = getApp();
    // 支付对象：子女端为父母支付则用父母openid，否则用自己的
    const payOpenid = this.data.isParentPay ? app.globalData.bindParentOpenid : app.globalData.openid;

    try {
      wx.showLoading({ title: "创建订单中..." });
      const res = await wx.cloud.callFunction({
        name: "createPayOrder",
        data: { openid: payOpenid, payType: type, amount }, // 传入对应openid
      });
      wx.hideLoading();

      if (res.result?.success) {
        const payParams = res.result.payParams;
        wx.requestPayment({
          ...payParams,
          success: async () => {
            // 为父母支付则更新父母的账号状态，否则更新自己的
            if (this.data.isParentPay) {
              await this.updateParentVersion(type, payOpenid);
              wx.showToast({ title: "为父母升级/续费成功" });
            } else {
              await this.updateUserVersion(type);
              const toastTitle = this.data.isFormalVersion ? "续费成功" : "升级成功";
              wx.showToast({ title: toastTitle });
            }
            this.closePayDialog();
            this.loadAllUserData();
          },
          fail: (payErr) => {
            console.error("支付请求失败：", payErr);
            wx.showToast({
              title: payErr.errMsg.includes("cancel") ? "已取消支付" : "支付失败",
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

  // ========== 子女端特有：更新父母的版本状态（新增） ==========
  async updateParentVersion(payType, parentOpenid) {
    try {
      const now = new Date();
      const userRes = await db.collection("users")
        .where({ _openid: parentOpenid })
        .get();

      let currentServiceEnd;
      if (userRes.data.length > 0) {
        const userData = userRes.data[0];
        const trialEndTime = new Date(userData.serviceEndTime);
        currentServiceEnd = new Date() > trialEndTime ? now : trialEndTime;
      } else {
        currentServiceEnd = now;
      }

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
        await db.collection("users")
          .doc(userRes.data[0]._id)
          .update({ data: updateData });
      } else {
        await db.collection("users")
          .add({
            data: {
              _openid: parentOpenid,
              ...updateData,
              createTime: db.serverDate(),
            },
          });
      }
    } catch (err) {
      console.error("更新父母版本失败：", err);
      wx.showToast({ title: "版本更新失败，请联系客服", icon: "none" });
    }
  },
// 生成6位子女绑定码（仅父母模式可用）
// 生成6位子女绑定码（仅父母模式可用）
// 生成6位子女绑定码（调用云函数实现）
generateBindCode() {
  // 1. 子女模式判断
  if (this.data.isChildMode) {
    wx.showToast({ title: "子女模式无法生成绑定码", icon: "none" });
    return;
  }

  wx.showLoading({ title: "生成中..." });
  // 调用云函数获取真实绑定码
  wx.cloud.callFunction({
    name: 'getBindCode',
    data: {},
    success: (res) => {
      wx.hideLoading();
      // 云函数调用成功且返回有效绑定码
      if (res.result && res.result.success && res.result.bindCode) {
        const bindCode = res.result.bindCode;
        // 直接同步弹框（和测试成功的逻辑完全一致，无延迟/嵌套）
        wx.showModal({
          title: "绑定码生成成功",
          content: `您的子女绑定码是：【${bindCode}】\n点击“复制”即可复制到剪贴板`,
          confirmText: "复制",
          cancelText: "关闭",
          success: (res) => {
            if (res.confirm) {
              wx.setClipboardData({
                data: bindCode,
                success: () => wx.showToast({ title: `码${bindCode}已复制`, icon: "success" }),
                fail: () => wx.showToast({ title: "复制失败：" + bindCode, icon: "none" })
              });
            }
          }
        });
      } else {
        // 云函数返回失败提示
        wx.showToast({ 
          title: res.result?.errMsg || "生成失败，请重试", 
          icon: "none" 
        });
      }
    },
    fail: (err) => {
      wx.hideLoading();
      console.error("云函数调用失败：", err);
      wx.showToast({ title: "云函数调用失败", icon: "none" });
    }
  });
},

// 独立的弹窗函数（显式接收bindCode，避免作用域问题）
showBindCodeModal(bindCode) {
  // 延迟执行弹窗
  setTimeout(() => {
    wx.showModal({
      title: "子女绑定码已生成",
      content: `您的子女绑定码是：【${bindCode}】\n请将此码告知子女，用于绑定您的账号`,
      confirmText: "复制绑定码",
      cancelText: "知道了",
      success: (res) => {
        if (res.confirm) {
          wx.setClipboardData({
            data: bindCode,
            success: () => {
              wx.showToast({ title: "绑定码已复制", icon: "success" });
            },
            fail: () => {
              wx.showToast({ title: "复制失败，请手动记录", icon: "none" });
            }
          });
        }
      }
    });
  }, 100);
},
// 点击绑定码文本触发复制
copyBindCode(e) {
  const bindCode = e.currentTarget.dataset.code;
  wx.setClipboardData({
    data: bindCode,
    success: () => {
      wx.showToast({ title: "绑定码已复制", icon: "success" });
    }
  });
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
    // 页面切回时刷新模式状态
    const app = getApp();
    this.setData({
      isChildMode: app.globalData.currentMode === "child",
      bindParentInfo: app.globalData.bindParentInfo || {}
    });
  },

  // ========== 子女模式切换核心方法（新增） ==========
  // 1. 显示模式切换弹窗
  showModeSwitchSheet() {
    this.setData({ showModeSwitchSheet: true });
  },

  // 2. 取消模式切换
  cancelModeSwitch() {
    this.setData({ 
      showModeSwitchSheet: false, 
      bindCode: ""
    });
  },

  // 3. 绑定码输入
  onBindCodeInput(e) {
    this.setData({ bindCode: e.detail.value });
  },

  // 4. 确认模式切换（适配子女端）
  confirmModeSwitch() {
    const { isChildMode, bindCode } = this.data;
    const app = getApp();

    if (!isChildMode) {
      // 父母端切子女端：原有绑定码验证逻辑
      if (!bindCode || bindCode.length !== 6) {
        wx.showToast({ title: "请输入6位父母绑定码", icon: "none" });
        return;
      }
      db.collection("users").where({ bindCode })
        .get().then(res => {
          if (res.data.length === 0) {
            wx.showToast({ title: "绑定码无效", icon: "none" });
            return;
          }
          const parentOpenid = res.data[0]._openid;
          app.globalData.currentMode = "child";
          app.globalData.bindParentOpenid = parentOpenid;
          app.globalData.bindParentInfo = res.data[0];
          // 本地缓存模式状态，避免重启丢失
          wx.setStorageSync("currentMode", "child");
          wx.setStorageSync("bindParentOpenid", parentOpenid);
          wx.setStorageSync("bindParentInfo", res.data[0]);
          
          this.setData({ 
            isChildMode: true, 
            showModeSwitchSheet: false,
            bindParentInfo: res.data[0]
          });
          wx.showToast({ title: "已切换至子女模式" });
          this.loadAllUserData(); // 刷新父母数据
        }).catch(err => {
          console.error("验证绑定码失败：", err);
          wx.showToast({ title: "切换失败", icon: "none" });
        });
    } else {
      // 子女端切父母端：简化，直接清空绑定信息
      app.globalData.currentMode = "parent";
      app.globalData.bindParentOpenid = "";
      app.globalData.bindParentInfo = {};
      // 清空本地缓存
      wx.setStorageSync("currentMode", "parent");
      wx.setStorageSync("bindParentOpenid", "");
      wx.setStorageSync("bindParentInfo", {});
      
      this.setData({ 
        isChildMode: false, 
        showModeSwitchSheet: false,
        bindParentInfo: {},
        isParentPay: false
      });
      wx.showToast({ title: "已切换至父母模式" });
      this.loadAllUserData(); // 刷新自己数据
    }
  }
});