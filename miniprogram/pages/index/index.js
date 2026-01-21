const db = wx.cloud.database();
const contactsCol = db.collection("contacts");
const signCol = db.collection("signRecords");
const usersCol = db.collection("users");
const emailsCol = db.collection("emails");

Page({
  data: {
    isSigned: false,
    contactsList: [],
    showEmailDialog: false,
    showAddDialog: false,
    showPayDialog: false,
    contactForm: { name: "", phone: "" },
    email: "",
    emailList: [],
    userName: "",
    homeLocation: null,
    isFormalVersion: false,
    remainingTrialDays: 3,
    isTrialExpired: false,
    serviceStartTime: "",
    serviceEndTime: "",
  },

  onShareAppMessage() {
    return {
      title: "咱爸咱妈平安签，守护家人安全",
      path: "/pages/index/index",
    };
  },

  onShareTimeline() {
    return {
      title: "咱爸咱妈平安签，守护家人安全",
    };
  },

  async onLoad() {
    // 优化：先获取版本信息（异步），再检查试用期，避免数据未加载完成
    await this.getVersionInfo();
    this.checkTrialExpired();

    // 检查签到状态
    const isSignedCache = wx.getStorageSync("isSignedToday");
    if (isSignedCache) {
      this.setData({ isSigned: true });
    } else {
      await this.checkSignStatus().catch((err) =>
        console.error("检查签到状态失败：", err),
      );
    }

    // 获取联系人、邮箱列表
    this.getContactsList();
    this.checkUserEmail();
  },

  // 版本信息（修复试用天数计算、补充正式版逻辑）
  async getVersionInfo() {
    try {
      const app = getApp();
      const res = await usersCol
        .where({ _openid: app.globalData.openid })
        .get();

      if (res.data.length > 0) {
        const userInfo = res.data[0];
        const createTime = userInfo.createTime
          ? new Date(userInfo.createTime)
          : new Date();
        const isFormal = userInfo.isFormalVersion || false;

        // 计算试用结束时间（仅试用版生效）
        const trialEndTime = new Date(createTime);
        trialEndTime.setDate(trialEndTime.getDate() + 3);
        const remainingDays = isFormal
          ? 0
          : Math.ceil((trialEndTime - new Date()) / (1000 * 60 * 60 * 24));

        this.setData({
          userName: userInfo.name || "",
          homeLocation: userInfo.homeLocation || null,
          isFormalVersion: isFormal,
          remainingTrialDays: remainingDays > 0 ? remainingDays : 0,
          // 优先使用数据库中的服务时间，无则用创建时间/试用结束时间
          serviceStartTime:
            userInfo.serviceStartTime || this.formatDate(createTime),
          serviceEndTime:
            userInfo.serviceEndTime || this.formatDate(trialEndTime),
        });
      } else {
        // 新用户默认试用3天
        const now = new Date();
        const trialEndTime = new Date(now);
        trialEndTime.setDate(trialEndTime.getDate() + 3);
        this.setData({
          serviceStartTime: this.formatDate(now),
          serviceEndTime: this.formatDate(trialEndTime),
          remainingTrialDays: 3,
        });
      }
    } catch (err) {
      console.error("获取版本信息失败：", err);
    }
  },

  // 试用期检查（优化提示文案）
  async checkTrialExpired() {
    const { isFormalVersion, serviceEndTime } = this.data;
    if (!isFormalVersion) {
      const endDate = new Date(serviceEndTime);
      const now = new Date();
      const isExpired = now > endDate;
      this.setData({ isTrialExpired: isExpired });

      if (isExpired) {
        wx.showModal({
          title: "试用已到期",
          content: "您的3天试用已结束，升级正式版后可继续使用全部功能",
          showCancel: false,
          success: () => this.showPayDialog(),
        });
      }
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

  // 检查签到状态
  async checkSignStatus() {
    try {
      const app = getApp();
      const today = new Date();
      const start = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
      ).getTime();
      const end = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + 1,
      ).getTime();

      const res = await signCol
        .where({
          openid: app.globalData.openid,
          signTime: db.command.gte(start).and(db.command.lt(end)),
        })
        .get();

      const isSigned = res.data.length > 0;
      this.setData({ isSigned });
      wx.setStorageSync("isSignedToday", isSigned);
    } catch (err) {
      console.error("检查签到状态失败：", err);
    }
  },

  // 签到（增加防抖）
  async handleSign() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }
    if (this.data.isSigned) {
      return wx.showToast({ title: "今日已签到", icon: "none" });
    }

    try {
      const app = getApp();
      await signCol.add({
        data: {
          openid: app.globalData.openid,
          signTime: new Date().getTime(),
          createTime: db.serverDate(),
        },
      });
      this.setData({ isSigned: true });
      wx.setStorageSync("isSignedToday", true);
      wx.showToast({ title: "签到成功" });
    } catch (err) {
      console.error("签到失败：", err);
      wx.showToast({ title: "签到失败，请重试", icon: "none" });
    }
  },

  // 获取联系人列表
  async getContactsList() {
    try {
      const app = getApp();
      const res = await contactsCol
        .where({ _openid: app.globalData.openid })
        .get();
      this.setData({ contactsList: res.data });
    } catch (err) {
      console.error("获取联系人失败：", err);
      wx.showToast({ title: "加载联系人失败", icon: "none" });
    }
  },

  // 联系人表单输入
  onFormChange(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail; // van-field的输入值在e.detail中
    this.setData({
      [`contactForm.${key}`]: value,
    });
  },

  // 显示添加联系人弹窗
  showAddDialog() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }
    this.setData({ showAddDialog: true });
  },

  // 取消添加联系人
  onCancelAddContact() {
    this.setData({
      showAddDialog: false,
      contactForm: { name: "", phone: "" }, // 重置表单
    });
  },

  // 确认添加联系人（强化验证）
  async onConfirmAddContact() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    try {
      const app = getApp();
      const { name, phone } = this.data.contactForm;

      // 强化验证
      if (!name.trim()) {
        return wx.showToast({ title: "请输入联系人姓名", icon: "none" });
      }
      if (!phone.trim()) {
        return wx.showToast({ title: "请输入手机号", icon: "none" });
      }
      const phoneReg = /^1[3-9]\d{9}$/;
      if (!phoneReg.test(phone)) {
        return wx.showToast({ title: "请输入正确的11位手机号", icon: "none" });
      }

      await contactsCol.add({
        data: {
          name: name.trim(),
          phone: phone.trim(),
          openid: app.globalData.openid,
          createTime: db.serverDate(),
        },
      });

      wx.showToast({ title: "联系人添加成功" });
      this.onCancelAddContact();
      this.getContactsList();
    } catch (err) {
      console.error("添加联系人失败：", err);
      wx.showToast({ title: "添加失败，请重试", icon: "none" });
    }
  },

  // 删除联系人
  async deleteContact(e) {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    try {
      const id = e.currentTarget.dataset.id;
      await contactsCol.doc(id).remove();
      wx.showToast({ title: "联系人删除成功" });
      this.getContactsList();
    } catch (err) {
      console.error("删除联系人失败：", err);
      wx.showToast({ title: "删除失败，请重试", icon: "none" });
    }
  },

  // 检查用户邮箱
  async checkUserEmail() {
    try {
      const app = getApp();
      const res = await emailsCol
        .where({ _openid: app.globalData.openid })
        .get();
      this.setData({ emailList: res.data });
    } catch (err) {
      console.error("获取邮箱失败：", err);
      wx.showToast({ title: "加载邮箱列表失败", icon: "none" });
    }
  },

  // 邮箱输入
  emailChange(e) {
    this.setData({ email: e.detail });
  },

  // 显示添加邮箱弹窗
  showEmailDialog() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }
    this.setData({ showEmailDialog: true });
  },

  // 取消绑定邮箱
  cancelBindEmail() {
    this.setData({ showEmailDialog: false, email: "" });
  },

  // 绑定邮箱（强化验证）
  async bindEmail() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    try {
      const app = getApp();
      const { email } = this.data;

      // 强化验证
      if (!email.trim()) {
        return wx.showToast({ title: "请输入邮箱地址", icon: "none" });
      }
      const emailReg = /^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/;
      if (!emailReg.test(email)) {
        return wx.showToast({ title: "请输入正确的邮箱格式", icon: "none" });
      }

      // 检查是否已添加该邮箱
      const hasEmail = this.data.emailList.some(
        (item) => item.email === email.trim(),
      );
      if (hasEmail) {
        return wx.showToast({ title: "该邮箱已添加", icon: "none" });
      }

      await emailsCol.add({
        data: {
          email: email.trim(),
          openid: app.globalData.openid,
          createTime: db.serverDate(),
        },
      });

      wx.showToast({ title: "邮箱添加成功" });
      this.cancelBindEmail();
      this.checkUserEmail();
    } catch (err) {
      console.error("添加邮箱失败：", err);
      wx.showToast({ title: "添加失败，请重试", icon: "none" });
    }
  },

  // 删除邮箱
  async deleteEmail(e) {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    try {
      const id = e.currentTarget.dataset.id;
      await emailsCol.doc(id).remove();
      wx.showToast({ title: "邮箱删除成功" });
      this.checkUserEmail();
    } catch (err) {
      console.error("删除邮箱失败：", err);
      wx.showToast({ title: "删除失败，请重试", icon: "none" });
    }
  },

  // 拨打电话
  callPhone(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) {
      return wx.showToast({ title: "手机号为空", icon: "none" });
    }
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: (err) => {
        if (err.errMsg.includes("cancel")) {
          wx.showToast({ title: "已取消拨号", icon: "none" });
        } else {
          wx.showToast({ title: "拨号失败，请重试", icon: "none" });
        }
      },
    });
  },

  // 姓名输入
  onUserNameInput(e) {
    this.setData({ userName: e.detail.value });
  },

  // 保存姓名
  async saveUserName() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    try {
      const app = getApp();
      const { userName } = this.data;

      if (!userName.trim()) {
        return wx.showToast({ title: "请输入姓名", icon: "none" });
      }

      const res = await usersCol
        .where({ _openid: app.globalData.openid })
        .get();
      if (res.data.length > 0) {
        await usersCol
          .doc(res.data[0]._id)
          .update({ data: { name: userName.trim() } });
      } else {
        await usersCol.add({
          data: {
            name: userName.trim(),
            createTime: db.serverDate(),
            _openid: app.globalData.openid,
          },
        });
      }

      wx.showToast({ title: "姓名保存成功" });
    } catch (err) {
      console.error("保存备注失败：", err);
      wx.showToast({ title: "保存失败，请重试", icon: "none" });
    }
  },

  // 设置家庭位置
  setHomeLocation() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    wx.chooseLocation({
      success: async (res) => {
        const homeLocation = {
          lat: res.latitude,
          lng: res.longitude,
          address: res.address,
        };
        try {
          const app = getApp();
          const userRes = await usersCol
            .where({ _openid: app.globalData.openid })
            .get();

          if (userRes.data.length > 0) {
            await usersCol
              .doc(userRes.data[0]._id)
              .update({ data: { homeLocation } });
          } else {
            await usersCol.add({
              data: {
                homeLocation,
                createTime: db.serverDate(),
                _openid: app.globalData.openid,
              },
            });
          }

          this.setData({ homeLocation });
          wx.showToast({ title: "家庭位置设置成功" });
        } catch (err) {
          console.error("保存位置失败：", err);
          wx.showToast({ title: "设置失败，请重试", icon: "none" });
        }
      },
      fail: (err) => {
        if (err.errMsg.includes("auth deny")) {
          wx.showModal({
            title: "权限提示",
            content: "需要获取您的位置权限才能设置家庭位置，请前往开启",
            confirmText: "去设置",
            cancelText: "取消",
            success: (res) => {
              if (res.confirm) {
                wx.openSetting({
                  success: (settingRes) => {
                    if (settingRes.authSetting["scope.userLocation"]) {
                      this.setHomeLocation();
                    }
                  },
                });
              }
            },
          });
        } else if (!err.errMsg.includes("cancel")) {
          wx.showToast({ title: "获取位置失败，请重试", icon: "none" });
        }
      },
    });
  },

  // 一键回家
  goHome() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    const { homeLocation } = this.data;
    if (!homeLocation) {
      return wx.showModal({
        title: "提示",
        content: "请先设置家庭位置",
        showCancel: false,
        confirmText: "去设置",
      });
    }

    wx.openLocation({
      latitude: homeLocation.lat,
      longitude: homeLocation.lng,
      name: "家",
      address: homeLocation.address,
      fail: () => wx.showToast({ title: "唤起导航失败，请重试", icon: "none" }),
    });
  },

  // 发送定位
  sendLocation() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    if (this.data.emailList.length === 0) {
      return wx.showModal({
        title: "提示",
        content: "请先添加提醒邮箱，定位将发送至该邮箱",
        showCancel: false,
        confirmText: "去添加",
      });
    }

    wx.getLocation({
      type: "gcj02",
      success: async (res) => {
        const location = { lat: res.latitude, lng: res.longitude };
        try {
          wx.showLoading({ title: "发送中..." });
          const app = getApp();
          const sendRes = await wx.cloud.callFunction({
            name: "sendLocationEmail",
            data: {
              location,
              emailList: this.data.emailList,
              userName: this.data.userName || "用户",
            },
          });
          wx.hideLoading();

          if (sendRes.result?.success) {
            wx.showToast({ title: "定位邮件发送成功" });
          } else {
            wx.showToast({
              title: `发送失败：${sendRes.result?.msg || "服务器异常"}`,
              icon: "none",
              duration: 3000,
            });
          }
        } catch (err) {
          wx.hideLoading();
          console.error("发送定位失败：", err);
          wx.showToast({ title: "发送失败，请重试", icon: "none" });
        }
      },
      fail: (err) => {
        if (err.errMsg.includes("auth deny")) {
          wx.showModal({
            title: "权限提示",
            content: "需要获取您的位置权限才能发送定位，请前往开启",
            confirmText: "去设置",
            cancelText: "取消",
            success: (res) => {
              if (res.confirm) {
                wx.openSetting({
                  success: (settingRes) => {
                    if (settingRes.authSetting["scope.userLocation"]) {
                      this.sendLocation();
                    }
                  },
                });
              }
            },
          });
        } else if (!err.errMsg.includes("cancel")) {
          wx.showToast({ title: "获取位置失败，请重试", icon: "none" });
        }
      },
    });
  },

  // 显示支付弹窗
  showPayDialog() {
    this.setData({ showPayDialog: true });
  },

  // 关闭支付弹窗
  closePayDialog() {
    this.setData({ showPayDialog: false });
  },

  // 选择支付类型
  async choosePayType(e) {
    const type = e.currentTarget.dataset.type;
    const amount = type === "month" ? 3 : 20;

    try {
      // wx.showLoading({ title: "创建订单中..." });
      const app = getApp();
      const res = await wx.cloud.callFunction({
        name: "createPayOrder",
        data: { openid: app.globalData.openid, payType: type, amount },
      });
      // wx.hideLoading();

      console.log("云函数返回：", res.result);

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
      // wx.hideLoading();
      console.error("支付失败：", err);
      wx.showToast({ title: "支付异常，请重试", icon: "none" });
    }
  },

  // 更新用户版本（修复时间计算错误、补充服务开始时间）
  async updateUserVersion(payType) {
    try {
      const app = getApp();
      const now = new Date();
      let serviceEndTime = new Date(now);

      // 修复：年付应该用setFullYear，不是setDate
      if (payType === "month") {
        serviceEndTime.setDate(serviceEndTime.getDate() + 30); // 月付+30天
      } else {
        serviceEndTime.setFullYear(serviceEndTime.getFullYear() + 1); // 年付+1年
      }

      const userRes = await usersCol
        .where({ _openid: app.globalData.openid })
        .get();
      const updateData = {
        isFormalVersion: true,
        serviceStartTime: this.formatDate(now), // 补充：设置服务开始时间
        serviceEndTime: this.formatDate(serviceEndTime),
        payType,
        lastPayTime: db.serverDate(),
        trialExpired: false, // 重置试用过期状态
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

      // 重新加载版本信息
      await this.getVersionInfo();
      this.setData({ isTrialExpired: false });
    } catch (err) {
      console.error("更新版本失败：", err);
      wx.showToast({ title: "版本更新失败，请联系客服", icon: "none" });
    }
  },
});
