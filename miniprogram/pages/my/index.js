const db = wx.cloud.database();
const usersCol = db.collection("users");
const bindRelationsCol = db.collection("bindRelations");

Page({
  data: {
    isAdmin: false,
    isFormalVersion: false,
    remainingTrialDays: 3,
    isTrialExpired: false,
    serviceStartTime: "",
    serviceEndTime: "",
    showPayDialog: false,
    showAboutDialog: false,
    userInfo: {
      name: "",
      homeLocation: null,
      enableRemind: true,
    },
    // 缓存优先初始化，避免首次渲染默认值闪烁
    careMode: wx.getStorageSync("careMode") || false,
    fontSizeMultiple: wx.getStorageSync("fontSizeMultiple") || 1.0,
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
    // 先设默认值，避免this初始化报错，onLoad中再动态赋值
    currentFontIndex: 0,
    isChildMode: false,
    showModeSwitchSheet: false,
    bindCode: "",
    bindParentInfo: {},
    isParentPay: false,
    parentPayInfo: {
      isFormalVersion: false,
      remainingTrialDays: 3,
      isTrialExpired: false,
      serviceStartTime: "",
      serviceEndTime: "",
      enableRemind: false,
    },

    // 团长中心新增字段
    showGroupLeaderCenter: false,
    isGroupLeader: false,
    groupLeaderData: {
      pendingReward: 0,
      withdrawAble: 0,
      totalOrder: 0,
    },
    groupOrderList: [],
    showGroupLeaderRule: false,
    showOrderDetail: false,
    showWithdrawResult: false,
    withdrawResult: "",
  },

  onLoad() {
    const app = getApp();
    this.setData({
      isChildMode: app.globalData.currentMode === "child",
      bindParentInfo: app.globalData.bindParentInfo || {},
    });
    // 核心修复：动态初始化currentFontIndex（此时this已实例化，可正常访问data）
    const cacheFont = wx.getStorageSync("fontSizeMultiple");
    if (cacheFont) {
      const fontIndex = this.data.fontOptions.findIndex(
        (item) => item.value === cacheFont,
      );
      if (fontIndex >= 0) {
        this.setData({ currentFontIndex: fontIndex });
      }
    }

    this.loadCareModeSetting();
    this.checkAdminPermission(); // 校验管理员权限
    this.loadAllUserData();
  },
  // 校验是否为管理员
  async checkAdminPermission() {
    const app = getApp();
    const openid = app.globalData.openid;
    try {
      const res = await db.collection("adminUsers").where({ openid }).get();
      this.setData({ isAdmin: res.data.length > 0 });
    } catch (err) {
      console.error("校验管理员权限失败：", err);
      this.setData({ isAdmin: false });
    }
  },
  // 跳转后台设置页面
  navigateToAdmin() {
    wx.navigateTo({ url: "/pages/admin/index" });
  },
  // 权限校验通用方法
  async checkChildPermission(targetOpenid) {
    const app = getApp();
    if (!this.data.isChildMode) return true;

    try {
      const bindRes = await bindRelationsCol.doc(app.globalData.openid).get();
      if (!bindRes.data) {
        wx.showToast({ title: "未绑定父母账号，请重新绑定", icon: "none" });
        return false;
      }
      if (bindRes.data.parentOpenid !== targetOpenid) {
        wx.showToast({ title: "无权限操作该父母数据", icon: "none" });
        return false;
      }
      return true;
    } catch (err) {
      console.error("权限校验失败：", err);
      wx.showToast({ title: `校验失败：${err.errMsg}`, icon: "none" });
      return false;
    }
  },
  // 优化版：仅差异化更新字体配置，避免重复setData导致闪烁
  loadCareModeSetting() {
    try {
      const app = getApp();
      const targetOpenid = this.data.isChildMode
        ? app.globalData.bindParentOpenid
        : app.globalData.openid;
      // 已从data初始值读取缓存，无需重复设置初始状态
      const currentCareMode = this.data.careMode;
      const currentFontSize = this.data.fontSizeMultiple;
      // 子女模式无父母openid，直接返回
      if (this.data.isChildMode && !targetOpenid) {
        return;
      }
      // 仅数据库配置与当前状态不一致时，才更新页面+缓存
      usersCol
        .where({ _openid: targetOpenid })
        .get()
        .then((res) => {
          if (res.data.length > 0) {
            const dbCareMode = res.data[0].careMode || false;
            const dbFontSize = res.data[0].fontSizeMultiple || 1.0;
            const dbFontIndex =
              this.data.fontOptions.findIndex(
                (item) => item.value === dbFontSize,
              ) || 0;

            if (
              dbCareMode !== currentCareMode ||
              dbFontSize !== currentFontSize
            ) {
              this.setData({
                careMode: dbCareMode,
                fontSizeMultiple: dbFontSize,
                currentFontIndex: dbFontIndex,
              });
              // 同步更新本地缓存，保证下次启动一致
              wx.setStorageSync("careMode", dbCareMode);
              wx.setStorageSync("fontSizeMultiple", dbFontSize);
            }
          }
        })
        .catch((err) => {
          console.error("读取关怀模式失败：", err);
        });
    } catch (err) {
      console.error("读取关怀模式设置失败：", err);
      // 兜底仅缓存无数据时执行，避免覆盖已有配置
      if (!wx.getStorageSync("careMode")) {
        this.setData({
          careMode: false,
          fontSizeMultiple: 1.0,
          currentFontIndex: 0,
        });
      }
    }
  },
  // 关怀模式开关：关闭时强制还原1.0倍字体，无歧义
  onCareModeSwitchChange(e) {
    const careMode = e.detail.value;
    const currentFontIndex = this.data.currentFontIndex || 0;
    const currentFont = this.data.fontOptions[currentFontIndex] || {
      value: 1.1,
    };
    // 关闭关怀模式强制1.0倍，开启则使用选中的字体倍数
    const fontSizeMultiple = careMode ? currentFont.value : 1.0;

    const app = getApp();
    const targetOpenid = this.data.isChildMode
      ? app.globalData.bindParentOpenid
      : app.globalData.openid;
    // 先更新缓存，保证页面刷新后状态一致
    wx.setStorageSync("careMode", careMode);
    wx.setStorageSync("fontSizeMultiple", fontSizeMultiple);

    this.setData(
      {
        careMode: careMode,
        fontSizeMultiple: fontSizeMultiple,
        currentFontIndex: currentFontIndex,
      },
      () => {
        // 有目标openid时，同步更新数据库
        if (targetOpenid) {
          usersCol
            .where({ _openid: targetOpenid })
            .get()
            .then((res) => {
              const updateData = { careMode, fontSizeMultiple };
              if (res.data.length > 0) {
                usersCol.doc(res.data[0]._id).update({ data: updateData });
              } else {
                usersCol.add({
                  data: {
                    _openid: targetOpenid,
                    ...updateData,
                    createTime: db.serverDate(),
                  },
                });
              }
            })
            .catch((err) => {
              console.error("更新关怀模式失败：", err);
            });
        }
      },
    );

    wx.showToast({
      title: careMode ? "已开启关怀模式" : "已关闭关怀模式（字体已还原）",
      icon: "none",
    });
  },
  // 字体大小选择：同步更新页面、缓存、数据库
  onFontChange(e) {
    const index = e.detail.value;
    const selectedFont = this.data.fontOptions[index];
    const app = getApp();
    const targetOpenid = this.data.isChildMode
      ? app.globalData.bindParentOpenid
      : app.globalData.openid;
    // 先更新页面状态
    this.setData({
      currentFontIndex: index,
      fontSizeMultiple: selectedFont.value,
    });
    wx.setStorageSync("fontSizeMultiple", selectedFont.value);

    if (targetOpenid) {
      usersCol
        .where({ _openid: targetOpenid })
        .get()
        .then((res) => {
          const updateData = {
            fontSizeMultiple: selectedFont.value,
            currentFontIndex: index,
          };
          if (res.data.length > 0) {
            usersCol.doc(res.data[0]._id).update({ data: updateData });
          } else {
            usersCol.add({ data: { _openid: targetOpenid, ...updateData } });
          }
        })
        .catch((err) => {
          console.error("更新字体大小失败：", err);
        });
    }
  },

  async loadAllUserData() {
    try {
      const app = getApp();
      if (this.data.isChildMode) {
        const parentOpenid = app.globalData.bindParentOpenid;
        if (!parentOpenid) return;

        const res = await usersCol.where({ _openid: parentOpenid }).get();
        if (res.data.length > 0) {
          const parentData = res.data[0];
          const createTime = parentData.createTime
            ? new Date(parentData.createTime)
            : new Date();
          const isFormal = parentData.isFormalVersion || false;
          const trialEndTime = new Date(
            parentData.serviceEndTime ||
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

          this.setData({
            bindParentInfo: parentData,
            parentPayInfo: {
              isFormalVersion: isFormal,
              remainingTrialDays: remainingDays,
              isTrialExpired: !isFormal && now > trialEndTime,
              serviceStartTime:
                parentData.serviceStartTime || this.formatDate(createTime),
              serviceEndTime: this.formatDate(trialEndTime),
              enableRemind: parentData.enableRemind ?? false,
            },
          });
        }
      } else {
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
          const isTrialExpired = !isFormal && now > trialEndTime;

          const userInfo = {
            name: userData.name || "",
            homeLocation: userData.homeLocation || null,
            enableRemind: isTrialExpired
              ? false
              : (userData.enableRemind ?? true),
          };

          this.setData({
            isFormalVersion: isFormal,
            remainingTrialDays: remainingDays,
            serviceStartTime:
              userData.serviceStartTime || this.formatDate(createTime),
            serviceEndTime: this.formatDate(trialEndTime),
            isTrialExpired: isTrialExpired,
            userInfo: userInfo,
          });

          if (isTrialExpired) {
            wx.showModal({
              title: "试用已到期",
              content:
                "您的3天试用已结束，升级正式版后可继续使用全部功能【虚拟会员服务，一经付费概不退款】",
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
      }
    } catch (err) {
      console.error("加载用户数据失败：", err);
      wx.showToast({ title: "加载数据失败，请重试", icon: "none" });
    } finally {
      this.loadGroupLeaderData();
    }
  },
  // 日期格式化：YYYY-MM-DD
  formatDate(date) {
    date = new Date(date);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
  },
  // 邮件提醒开关：区分父母/自己模式，校验子女操作权限
  async onRemindSwitchChange(e) {
    const enableRemind = e.detail.value;
    const app = getApp();
    const targetOpenid = this.data.isChildMode
      ? app.globalData.bindParentOpenid
      : app.globalData.openid;

    const hasPermission = await this.checkChildPermission(targetOpenid);
    if (!hasPermission) return;

    try {
      const res = await usersCol.where({ _openid: targetOpenid }).get();
      if (res.data.length > 0) {
        await usersCol.doc(res.data[0]._id).update({ data: { enableRemind } });
      } else {
        await usersCol.add({
          data: {
            _openid: targetOpenid,
            enableRemind,
            createTime: db.serverDate(),
          },
        });
      }

      this.setData({
        "userInfo.enableRemind": !this.data.isChildMode
          ? enableRemind
          : this.data.userInfo.enableRemind,
        "parentPayInfo.enableRemind": this.data.isChildMode
          ? enableRemind
          : this.data.parentPayInfo.enableRemind,
      });
      wx.showToast({ title: enableRemind ? "提醒已开启" : "提醒已关闭" });
    } catch (err) {
      console.error("修改提醒状态失败：", err);
      wx.showToast({ title: "修改失败，请重试", icon: "none" });
    }
  },

  showPayDialog() {
    this.setData({ showPayDialog: true, isParentPay: false });
  },

  showParentPayDialog() {
    const app = getApp();
    if (!app.globalData.bindParentOpenid) {
      return wx.showToast({ title: "未绑定父母账号", icon: "none" });
    }
    this.setData({ showPayDialog: true, isParentPay: true });
  },

  closePayDialog() {
    this.setData({ showPayDialog: false, isParentPay: false });
  },

  async choosePayType(e) {
    const type = e.currentTarget.dataset.type;
    const amount = type === "month" ? 3 : 20;
    const app = getApp();
    const payOpenid = this.data.isParentPay
      ? app.globalData.bindParentOpenid
      : app.globalData.openid;

    try {
      wx.showLoading({ title: "创建订单中..." });
      const res = await wx.cloud.callFunction({
        name: "createPayOrder",
        data: {
          openid: payOpenid, // 原有：支付目标openid
          payType: type, // 原有：月付/年付
          amount, // 原有：支付金额
          payerOpenid: app.globalData.openid, // 原有：付款人openid
          leaderOpenid: app.globalData.openid, // 新增：当前付款人=推广团长（自己推广自己也计数）
        },
      });
      wx.hideLoading();

      if (res.result?.success) {
        const payParams = res.result.payParams;
        wx.requestPayment({
          ...payParams,
          success: async () => {
            if (this.data.isParentPay) {
              await this.updateParentVersion(type, payOpenid);
              wx.showToast({ title: "为父母升级/续费成功" });
            } else {
              await this.updateUserVersion(type);
              const toastTitle = this.data.isFormalVersion
                ? "续费成功"
                : "升级成功";
              wx.showToast({ title: toastTitle });
            }
            this.closePayDialog();
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

  async updateUserVersion(payType) {
    try {
      const app = getApp();
      const now = new Date();
      const userRes = await usersCol
        .where({ _openid: app.globalData.openid })
        .get();

      let currentServiceEnd = now;
      if (userRes.data.length > 0) {
        const userData = userRes.data[0];
        const trialEndTime = new Date(userData.serviceEndTime);
        currentServiceEnd = this.data.isTrialExpired ? now : trialEndTime;
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
    } catch (err) {
      console.error("更新版本失败：", err);
      wx.showToast({ title: "版本更新失败，请联系客服", icon: "none" });
    }
  },

  async updateParentVersion(payType, parentOpenid) {
    try {
      const now = new Date();
      const userRes = await usersCol.where({ _openid: parentOpenid }).get();

      let currentServiceEnd = now;
      if (userRes.data.length > 0) {
        const userData = userRes.data[0];
        const trialEndTime = new Date(userData.serviceEndTime);
        currentServiceEnd = new Date() > trialEndTime ? now : trialEndTime;
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
        await usersCol.doc(userRes.data[0]._id).update({ data: updateData });
      } else {
        await usersCol.add({
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

  generateBindCode() {
    if (this.data.isChildMode) {
      wx.showToast({ title: "子女模式无法生成绑定码", icon: "none" });
      return;
    }

    wx.showLoading({ title: "生成中..." });
    wx.cloud.callFunction({
      name: "getBindCode",
      data: {},
      success: (res) => {
        wx.hideLoading();
        if (res.result && res.result.success && res.result.bindCode) {
          const newBindCode = res.result.bindCode;
          const app = getApp();

          usersCol
            .where({ _openid: app.globalData.openid })
            .get()
            .then((userRes) => {
              if (userRes.data.length > 0) {
                usersCol.doc(userRes.data[0]._id).update({
                  data: {
                    bindCode: newBindCode,
                    bindCodeUpdateTime: db.serverDate(),
                  },
                });
              }
            });

          wx.showModal({
            title: "绑定码生成成功",
            content: `新绑定码：【${newBindCode}】\n旧绑定码已失效，已绑定的子女可正常使用\n点击“复制”即可复制到剪贴板`,
            confirmText: "复制",
            cancelText: "关闭",
            success: (res) => {
              if (res.confirm) {
                wx.setClipboardData({
                  data: newBindCode,
                  success: () =>
                    wx.showToast({
                      title: `码${newBindCode}已复制`,
                      icon: "success",
                    }),
                  fail: () =>
                    wx.showToast({
                      title: "复制失败：" + newBindCode,
                      icon: "none",
                    }),
                });
              }
            },
          });
        } else {
          wx.showToast({
            title: res.result?.errMsg || "生成失败，请重试",
            icon: "none",
          });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        console.error("云函数调用失败：", err);
        wx.showToast({ title: "云函数调用失败", icon: "none" });
      },
    });
  },

  copyBindCode(e) {
    const bindCode = e.currentTarget.dataset.code;
    wx.setStorageSync("bindCode", bindCode);
    wx.setClipboardData({
      data: bindCode,
      success: () => wx.showToast({ title: "绑定码已复制", icon: "success" }),
    });
  },

  showAboutDialog() {
    this.setData({ showAboutDialog: true });
  },

  closeAboutDialog() {
    this.setData({ showAboutDialog: false });
  },

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
    const app = getApp();
    this.setData({
      isChildMode: app.globalData.currentMode === "child",
      bindParentInfo: app.globalData.bindParentInfo || {},
    });
    this.loadAllUserData();
  },

  showModeSwitchSheet() {
    this.setData({ showModeSwitchSheet: true });
  },

  cancelModeSwitch() {
    this.setData({ showModeSwitchSheet: false, bindCode: "" });
  },

  onBindCodeInput(e) {
    this.setData({ bindCode: e.detail.value });
  },

  confirmModeSwitch() {
    const { isChildMode, bindCode } = this.data;
    const app = getApp();

    if (!isChildMode) {
      if (!bindCode || bindCode.length !== 6) {
        wx.showToast({ title: "请输入6位父母绑定码", icon: "none" });
        return;
      }
      db.collection("users")
        .where({ bindCode })
        .get()
        .then((res) => {
          if (res.data.length === 0) {
            wx.showToast({ title: "绑定码无效", icon: "none" });
            return;
          }
          const parentOpenid = res.data[0]._openid;
          app.globalData.currentMode = "child";
          app.globalData.bindParentOpenid = parentOpenid;
          app.globalData.bindParentInfo = res.data[0];
          wx.setStorageSync("currentMode", "child");
          wx.setStorageSync("bindParentOpenid", parentOpenid);
          wx.setStorageSync("bindParentInfo", res.data[0]);

          this.setData({
            isChildMode: true,
            showModeSwitchSheet: false,
            bindParentInfo: res.data[0],
          });
          wx.showToast({ title: "已切换至子女模式" });
          this.loadAllUserData();
        })
        .catch((err) => {
          console.error("验证绑定码失败：", err);
          wx.showToast({ title: "切换失败", icon: "none" });
        });
    } else {
      app.globalData.currentMode = "parent";
      app.globalData.bindParentOpenid = "";
      app.globalData.bindParentInfo = {};
      wx.setStorageSync("currentMode", "parent");
      wx.setStorageSync("bindParentOpenid", "");
      wx.setStorageSync("bindParentInfo", {});

      this.setData({
        isChildMode: false,
        showModeSwitchSheet: false,
        bindParentInfo: {},
        isParentPay: false,
        parentPayInfo: {
          isFormalVersion: false,
          remainingTrialDays: 3,
          isTrialExpired: false,
          serviceStartTime: "",
          serviceEndTime: "",
          enableRemind: false,
        },
      });
      wx.showToast({ title: "已切换至父母模式" });
      this.loadAllUserData();
    }
  },

  // ==================== 团长中心方法 ====================
  showGroupLeaderCenter() {
    wx.navigateTo({
      url: "/pages/groupLeader/index",
    });
  },

  async loadGroupLeaderData() {
    const isPay =
      this.data.isFormalVersion || this.data.parentPayInfo.isFormalVersion;
    if (!isPay) {
      this.setData({ isGroupLeader: false });
      return;
    }
    try {
      const app = getApp();
      const res = await wx.cloud.callFunction({
        name: "groupLeader",
        data: {
          action: "getData",
          openid: app.globalData.openid,
        },
      });
      if (res.result.success) {
        this.setData({
          isGroupLeader: true,
          groupLeaderData: res.result.data || {
            pendingReward: 0,
            withdrawAble: 0,
            totalOrder: 0,
          },
          groupOrderList: res.result.orderList || [],
        });
      }
    } catch (err) {
      console.error("loadGroupLeaderData", err);
    }
  },

  copyShareLink() {
    const app = getApp();
    const link = `#小程序://咱爸咱妈平安签/sCXdY0FvLESnAsv?leaderOpenid=${app.globalData.openid}`;
    wx.setClipboardData({
      data: link,
      success: () => wx.showToast({ title: "推广链接已复制" }),
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },

  saveSharePoster() {
    wx.showLoading({ title: "生成海报中..." });
    const app = getApp();
    wx.cloud.callFunction({
      name: "groupLeader",
      data: { action: "generatePoster", openid: app.globalData.openid },
      success: (res) => {
        wx.hideLoading();
        if (res.result.success) {
          wx.saveImageToPhotosAlbum({
            filePath: res.result.posterPath,
            success: () => wx.showToast({ title: "海报已保存到相册" }),
            fail: () => wx.showToast({ title: "保存失败", icon: "none" }),
          });
        } else {
          wx.showToast({ title: "生成海报失败", icon: "none" });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: "生成海报失败", icon: "none" });
      },
    });
  },

  async applyWithdraw() {
    const { withdrawAble } = this.data.groupLeaderData;
    if (withdrawAble < 1) {
      wx.showToast({ title: "可提现金额≥1元才能申请", icon: "none" });
      return;
    }
    wx.showLoading({ title: "提交申请中..." });
    try {
      const app = getApp();
      const res = await wx.cloud.callFunction({
        name: "groupLeader",
        data: {
          action: "applyWithdraw",
          openid: app.globalData.openid,
          amount: withdrawAble,
        },
      });
      wx.hideLoading();
      if (res.result.success) {
        this.setData({
          showWithdrawResult: true,
          withdrawResult: "提现申请已提交，1-2个工作日审核，到账微信零钱",
          "groupLeaderData.withdrawAble": 0,
        });
      } else {
        this.setData({
          showWithdrawResult: true,
          withdrawResult: res.result.msg || "提现申请失败",
        });
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({
        showWithdrawResult: true,
        withdrawResult: "提现异常，请联系客服",
      });
    }
  },
  // 跳转到独立团长中心页面
  goToGroupLeader() {
    wx.navigateTo({
      url: "/pages/groupLeader/index",
      fail: () => {
        wx.showToast({ title: "团长中心页面不存在", icon: "none" });
      },
    });
  },

  // 跳转到提现审核后台
  goToWithdrawAudit() {
    wx.navigateTo({
      url: "/pages/withdrawAudit/index",
      fail: () => {
        wx.showToast({ title: "审核后台页面不存在", icon: "none" });
      },
    });
  },
  closeGroupLeaderDialogs() {
    this.setData({
      showGroupLeaderCenter: false,
      showGroupLeaderRule: false,
      showOrderDetail: false,
      showWithdrawResult: false,
    });
  },
});
