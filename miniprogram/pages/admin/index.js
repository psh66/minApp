const db = wx.cloud.database();
const usersCol = db.collection("users");
const adminUsersCol = db.collection("adminUsers");
const noticeCol = db.collection("noticeConfig");
// 新增：订单和推广订单集合
const ordersCol = db.collection("orders");
const rewardRecordsCol = db.collection("rewardRecords");

Page({
  data: {
    // 通知配置
    notice: {
      showNotice: false,
      noticeContent: "请输入通知内容",
    },
    // 用户数据
    allUsers: [],
    filteredUsers: [],
    currentFilter: "all",
    // 自定义续期天数
    extendDaysMap: {},
    // 字体适配
    fontSizeMultiple: 1.0,
    // 新增：订单相关（按用户ID存储订单/推广订单）
    userOrdersMap: {}, // 普通订单 {userId: [...订单列表]}
    userRewardRecordsMap: {}, // 推广订单 {userId: [...推广订单列表]}
    // 新增：控制订单弹窗显示
    showOrderModal: false,
    currentUserId: "", // 当前查看订单的用户ID
    currentUserName: "", // 当前查看订单的用户名
    activeOrderTab: "normal", // 订单弹窗标签：normal(普通订单)/reward(推广订单)
  },

  onLoad() {
    this.checkAdminPermission();
    this.loadAllUsers();
    this.loadFontSizeSetting();
    this.loadNoticeConfig();
  },

  // 校验管理员权限
  async checkAdminPermission() {
    const app = getApp();
    const openid = app.globalData.openid;
    try {
      const res = await adminUsersCol.where({ openid }).get();
      if (res.data.length === 0) {
        wx.showToast({ title: "无管理员权限", icon: "none" });
        wx.navigateBack();
      }
    } catch (err) {
      console.error("校验管理员权限失败：", err);
      wx.showToast({ title: "权限校验失败", icon: "none" });
      wx.navigateBack();
    }
  },

  // 加载通知配置
  async loadNoticeConfig() {
    console.log("===== 开始加载通知配置 =====");
    try {
      const res = await noticeCol.get();
      console.log("加载到的通知配置：", res.data);

      if (res.data.length > 0) {
        const latestNotice = {
          showNotice: res.data[0].showNotice || false,
          noticeContent: res.data[0].noticeContent || "请输入通知内容",
        };
        this.setData({ notice: latestNotice });
        console.log("页面通知配置更新为：", latestNotice);
      } else {
        this.setData({
          notice: {
            showNotice: false,
            noticeContent: "请输入通知内容",
          },
        });
        console.log("无现有配置，初始化默认值");
      }
    } catch (err) {
      console.error("加载通知配置失败：", err);
    }
    console.log("===== 加载通知配置流程结束 =====");
  },

  // 切换通知展示
  toggleNotice(e) {
    this.setData({ "notice.showNotice": e.detail.value });
  },

  // 更新通知内容
  updateNoticeContent(e) {
    this.setData({ "notice.noticeContent": e.detail.value });
  },

  // 保存通知配置
  async saveNoticeConfig() {
    console.log("===== 开始保存通知配置 =====");
    console.log("当前notice状态：", this.data.notice);

    try {
      const { notice } = this.data;
      const noticeData = notice || {
        showNotice: false,
        noticeContent: "请输入通知内容",
      };
      console.log("要保存的通知数据：", noticeData);

      const res = await noticeCol.get();
      console.log("noticeConfig集合现有数据：", res.data);

      const updateTime = new Date().toISOString();
      if (res.data.length > 0) {
        const targetId = res.data[0]._id;
        console.log("更新记录ID：", targetId);

        await noticeCol.doc(targetId).update({
          data: {
            showNotice: noticeData.showNotice,
            noticeContent: noticeData.noticeContent,
            updateTime: updateTime,
          },
        });
        console.log("更新数据库成功");
      } else {
        await noticeCol.add({
          data: {
            showNotice: noticeData.showNotice,
            noticeContent: noticeData.noticeContent,
            updateTime: updateTime,
            createTime: updateTime,
          },
        });
        console.log("新增数据库记录成功");
      }

      this.setData(
        {
          notice: {
            showNotice: noticeData.showNotice,
            noticeContent: noticeData.noticeContent,
          },
        },
        () => {
          console.log("页面状态更新成功：", this.data.notice);
        },
      );

      wx.showToast({ title: "通知配置保存成功" });
    } catch (err) {
      console.error("保存通知配置失败详情：", err);
      wx.showToast({
        title: `保存失败：${err.errMsg || "未知错误"}`,
        icon: "none",
      });
    }

    console.log("===== 保存通知配置流程结束 =====");
  },

  // 加载所有用户
  async loadAllUsers() {
    wx.showLoading({ title: "加载用户数据..." });
    try {
      const res = await usersCol.get();
      const allUsers = res.data.map((user) => {
        const isFormal = user.isFormalVersion || false;
        const serviceEndTime = new Date(user.serviceEndTime || new Date());
        const now = new Date();
        let userType = "";

        if (isFormal) {
          userType = now > serviceEndTime ? "expired" : "formal";
        } else {
          userType = now > serviceEndTime ? "expired" : "trial";
        }

        return {
          ...user,
          userType,
          serviceStartTime:
            user.serviceStartTime || this.formatDate(new Date(user.createTime)),
          serviceEndTime: this.formatDate(serviceEndTime),
        };
      });

      this.setData({ allUsers, filteredUsers: allUsers });
      wx.hideLoading();
    } catch (err) {
      console.error("加载用户数据失败：", err);
      wx.hideLoading();
      wx.showToast({ title: "加载失败，请重试", icon: "none" });
    }
  },

  // 筛选用户
  filterUsers(e) {
    const filterType = e.currentTarget.dataset.type;
    const { allUsers } = this.data;
    let filteredUsers = [];

    switch (filterType) {
      case "all":
        filteredUsers = allUsers;
        break;
      case "expired":
        filteredUsers = allUsers.filter((user) => user.userType === "expired");
        break;
      case "trial":
        filteredUsers = allUsers.filter((user) => user.userType === "trial");
        break;
      case "formal":
        filteredUsers = allUsers.filter((user) => user.userType === "formal");
        break;
    }

    this.setData({ currentFilter: filterType, filteredUsers });
  },

  // 记录续期天数
  setExtendDays(e) {
    const userId = e.currentTarget.dataset.id;
    const days = e.detail.value;
    this.setData({ [`extendDaysMap.${userId}`]: days });
  },

  // 自定义天数续期
  async extendService(e) {
    const userId = e.currentTarget.dataset.id;
    const days = this.data.extendDaysMap[userId];

    if (!days || days <= 0) {
      wx.showToast({ title: "请输入有效天数", icon: "none" });
      return;
    }

    wx.showModal({
      title: "续期确认",
      content: `确定为该用户续期${days}天服务时间吗？`,
      confirmText: "确认",
      cancelText: "取消",
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: "处理中..." });
          try {
            const userRes = await usersCol.doc(userId).get();
            const currentEndTime = new Date(
              userRes.data.serviceEndTime || new Date(),
            );
            const now = new Date();
            const newEndTime = currentEndTime > now ? currentEndTime : now;
            newEndTime.setDate(newEndTime.getDate() + Number(days));

            await usersCol.doc(userId).update({
              data: {
                serviceEndTime: this.formatDate(newEndTime),
                isFormalVersion: true,
                trialExpired: false,
                lastExtendTime: db.serverDate(),
              },
            });

            wx.hideLoading();
            wx.showToast({ title: `续期${days}天成功` });
            this.loadAllUsers();
            this.setData({ [`extendDaysMap.${userId}`]: "" });
          } catch (err) {
            wx.hideLoading();
            console.error("续期失败：", err);
            wx.showToast({ title: "续期失败，请重试", icon: "none" });
          }
        }
      },
    });
  },

  // 加载字体设置
  loadFontSizeSetting() {
    const careMode = wx.getStorageSync("careMode") || false;
    const fontSizeMultiple = wx.getStorageSync("fontSizeMultiple") || 1.0;
    this.setData({ fontSizeMultiple: careMode ? fontSizeMultiple : 1.0 });
  },

  // 日期格式化
  formatDate(date) {
    date = new Date(date);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

  // 新增：打开订单弹窗
  // 新增：打开订单弹窗
  // 新增：打开订单弹窗
  async openOrderModal(e) {
    const userId = e.currentTarget.dataset.id;
    const userName = e.currentTarget.dataset.name || "未知用户";

    wx.showLoading({ title: "加载订单数据..." });
    try {
      // 1. 先通过 userId 从 users 表中查询到对应的 openid
      const userRes = await usersCol.doc(userId).get();
      const userOpenid = userRes.data.openid;
      console.log("查询到的用户openid：", userOpenid, userRes.data);
      if (!userOpenid) {
        wx.hideLoading();
        wx.showToast({ title: "未找到该用户的openid", icon: "none" });
        return;
      }

      // 2. 加载普通订单：用 openid 关联用户
      const orderRes = await ordersCol
        .where({ openid: userOpenid })
        .orderBy("createTime", "desc")
        .get();
      const userOrders = (orderRes.data || []).map((item) => ({
        ...item,
        formatTime: this.formatDate(item.createTime || new Date()),
      }));
      console.log("查询到的订单数据：", userOrders);

      // 3. 加载推广订单：用 leaderOpenid 关联团长（核心修改：用 _id 替代 orderNo）
      const rewardRes = await rewardRecordsCol
        .where({ leaderOpenid: userOpenid })
        .orderBy("createTime", "desc")
        .get();
      const userRewards = (rewardRes.data || []).map((item) => ({
        ...item,
        orderNo: item._id, // ✅ 用推广记录的 _id 作为订单编号显示
        formatTime: this.formatDate(item.createTime || new Date()),
      }));
      console.log("查询到的推广订单数据：", userRewards);

      // 4. 更新数据
      this.setData({
        currentUserId: userId,
        currentUserName: userName,
        [`userOrdersMap.${userId}`]: userOrders,
        [`userRewardRecordsMap.${userId}`]: userRewards,
        showOrderModal: true,
        activeOrderTab: "normal",
      });
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      console.error("加载订单失败：", err);
      wx.showToast({ title: "加载订单失败", icon: "none" });
    }
  },

  // 新增：关闭订单弹窗
  closeOrderModal() {
    this.setData({
      showOrderModal: false,
      currentUserId: "",
      currentUserName: "",
    });
  },

  // 新增：切换订单标签
  switchOrderTab(e) {
    this.setData({ activeOrderTab: e.currentTarget.dataset.tab });
  },

  // 替换：删除普通订单（通过云函数）
  async deleteNormalOrder(e) {
    const { orderId, userId } = e.currentTarget.dataset;
    if (!orderId || !userId) {
      wx.showToast({
        title: "订单ID/用户ID不能为空",
        icon: "none",
        duration: 2000,
      });
      return;
    }

    wx.showModal({
      title: "删除确认",
      content: "确定要删除该订单吗？删除后不可恢复！",
      confirmColor: "#ff4d4f",
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: "删除中..." });

          try {
            // 调用云函数删除（核心修改）
            const cloudRes = await wx.cloud.callFunction({
              name: "deleteRecord",
              data: {
                recordId: orderId,
                collectionName: "orders", // 订单集合名
              },
            });

            wx.hideLoading();

            // 处理云函数返回结果
            if (cloudRes.result.success) {
              // 更新本地数据
              const userOrders = this.data.userOrdersMap[userId] || [];
              const newOrders = userOrders.filter(
                (item) => item._id !== orderId,
              );
              this.setData({
                [`userOrdersMap.${userId}`]: newOrders,
              });
              wx.showToast({
                title: "订单删除成功",
                icon: "success",
                duration: 1500,
              });
            } else {
              wx.showToast({
                title: cloudRes.result.msg || "删除失败",
                icon: "none",
                duration: 3000,
              });
            }
          } catch (err) {
            wx.hideLoading();
            console.error("调用删除云函数失败：", err);
            wx.showToast({
              title: `网络异常：${err.message || "请重试"}`,
              icon: "none",
              duration: 3000,
            });
          }
        }
      },
    });
  },

  // 替换：删除推广订单（通过云函数）
  async deleteRewardOrder(e) {
    const { recordId, userId } = e.currentTarget.dataset;
    if (!recordId || !userId) {
      wx.showToast({
        title: "推广订单ID/用户ID不能为空",
        icon: "none",
        duration: 2000,
      });
      return;
    }

    wx.showModal({
      title: "删除确认",
      content: "确定要删除该推广订单吗？删除后不可恢复！",
      confirmColor: "#ff4d4f",
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: "删除中..." });

          try {
            // 调用云函数删除（核心修改）
            const cloudRes = await wx.cloud.callFunction({
              name: "deleteRecord",
              data: {
                recordId: recordId,
                collectionName: "rewardRecords", // 推广订单集合名
              },
            });

            wx.hideLoading();

            // 处理云函数返回结果
            if (cloudRes.result.success) {
              // 更新本地数据
              const userRewards = this.data.userRewardRecordsMap[userId] || [];
              const newRewards = userRewards.filter(
                (item) => item._id !== recordId,
              );
              this.setData({
                [`userRewardRecordsMap.${userId}`]: newRewards,
              });
              wx.showToast({
                title: "推广订单删除成功",
                icon: "success",
                duration: 1500,
              });
            } else {
              wx.showToast({
                title: cloudRes.result.msg || "删除失败",
                icon: "none",
                duration: 3000,
              });
            }
          } catch (err) {
            wx.hideLoading();
            console.error("调用删除云函数失败：", err);
            wx.showToast({
              title: `网络异常：${err.message || "请重试"}`,
              icon: "none",
              duration: 3000,
            });
          }
        }
      },
    });
  },

  // 跳转到团长提现审核页面
  goToWithdrawAudit() {
    wx.navigateTo({
      url: "/pages/withdrawAudit/index",
    });
  },
});
