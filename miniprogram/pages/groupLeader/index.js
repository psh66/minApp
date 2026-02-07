const app = getApp();
const db = wx.cloud.database();

Page({
  data: {
    groupLeaderData: {
      pendingReward: 0,
      withdrawAble: 0,
      totalOrder: 0
    },
    orderList: [],
    withdrawRecords: [],
    showWithdrawModal: false,
    withdrawAmount: "",
    payeeInfo: {
      wechatName: "",
      wechatNo: ""
    }
  },

  onLoad() {
    // 校验全局openid是否存在（核心容错）
    if (!app.globalData?.openid) {
      wx.showToast({ title: "用户信息未初始化", icon: "none" });
      // 尝试重新获取openid（兜底逻辑）
      wx.cloud.callFunction({
        name: "login", // 假设你有login云函数获取openid
        success: (res) => {
          app.globalData.openid = res.result.openid;
          this.loadGroupLeaderData();
        },
        fail: () => {
          wx.showToast({ title: "获取用户ID失败", icon: "none" });
        }
      });
    } else {
      this.loadGroupLeaderData();
    }
  },

  // 加载团长核心数据
 // 加载团长核心数据（修复：添加rewardRecords请求）
loadGroupLeaderData() {
  wx.showLoading({ title: "加载中..." });
  wx.cloud.callFunction({
    name: "groupLeader",
    data: {
      action: "getData",
      openid: app.globalData.openid
    },
    success: (res) => {
      wx.hideLoading();
      if (res.result?.success) {
        // 新增：从云函数结果中取rewardRecords
        const rewardRecords = res.result.rewardRecords || [];
        this.setData({
          groupLeaderData: res.result.data || { pendingReward: 0, withdrawAble: 0, totalOrder: 0 },
          orderList: res.result.orderList || [],
          withdrawRecords: res.result.withdrawRecords || [],
          rewardRecords: rewardRecords // 关键：把佣金记录传给页面
        });
      } else {
        wx.showToast({ title: res.result?.msg || "数据加载失败", icon: "none" });
      }
    },
    fail: (err) => {
      wx.hideLoading();
      wx.showToast({ title: "调用接口失败", icon: "none" });
      console.error("团长数据加载失败：", err);
    }
  });
},

  // 唯一分享方式：分享给好友（卡片形式）
  shareToFriend() {
    // 主动触发微信分享面板
    wx.showShareMenu({
      withShareTicket: true,
      menus: ["shareAppMessage"] // 仅保留「分享给好友」
    });
    // 提示用户操作
    wx.showToast({ title: "请点击右上角「转发」", icon: "none", duration: 2000 });
  },

  // 分享卡片配置（核心：携带leaderOpenid实现绑定）
  onShareAppMessage() {
    const leaderOpenid = app.globalData.openid;
    return {
      title: "父母平安签，子女远程守护！",
      path: `/pages/index/index?leaderOpenid=${leaderOpenid}`, // 携带团长标识
      imageUrl: "../../images/001.jpg", // 确保该图片存在
      success: () => {
        wx.showToast({ title: "分享成功", icon: "success" });
      },
      fail: () => {
        wx.showToast({ title: "分享失败", icon: "none" });
      }
    };
  },

  // 提现弹窗-打开
  showWithdrawModal() {
    // 提前校验可提现金额
    if (this.data.groupLeaderData.withdrawAble < 1) {
      wx.showToast({ title: "可提现金额不足1元", icon: "none" });
      return;
    }
    this.setData({
      showWithdrawModal: true,
      withdrawAmount: this.data.groupLeaderData.withdrawAble.toString(),
      payeeInfo: { wechatName: "", wechatNo: "" }
    });
  },

  // 提现弹窗-关闭
  closeWithdrawModal() {
    this.setData({ showWithdrawModal: false });
  },

  // 输入框绑定（修复model:value兼容问题）
  bindWithdrawAmount(e) {
    this.setData({ withdrawAmount: e.detail.value });
  },
  bindWechatName(e) {
    this.setData({ "payeeInfo.wechatName": e.detail.value });
  },
  bindWechatNo(e) {
    this.setData({ "payeeInfo.wechatNo": e.detail.value });
  },

  // 提交提现申请
  submitWithdraw() {
    const { withdrawAmount, payeeInfo } = this.data;
    const openid = app.globalData.openid;
    const amount = Number(withdrawAmount);

    // 校验逻辑强化
    if (!withdrawAmount) {
      wx.showToast({ title: "请输入提现金额", icon: "none" });
      return;
    }
    if (isNaN(amount) || amount < 1) {
      wx.showToast({ title: "最低提现1元", icon: "none" });
      return;
    }
    if (amount > this.data.groupLeaderData.withdrawAble) {
      wx.showToast({ title: "提现金额不能超过可提现金额", icon: "none" });
      return;
    }
    if (!payeeInfo.wechatName.trim()) {
      wx.showToast({ title: "请填写微信昵称", icon: "none" });
      return;
    }
    if (!payeeInfo.wechatNo.trim()) {
      wx.showToast({ title: "请填写微信号/收款码信息", icon: "none" });
      return;
    }

    wx.showLoading({ title: "提交中..." });
    wx.cloud.callFunction({
      name: "groupLeader",
      data: {
        action: "applyWithdraw",
        openid,
        amount,
        payeeInfo: {
          wechatName: payeeInfo.wechatName.trim(),
          wechatNo: payeeInfo.wechatNo.trim()
        }
      },
      success: (res) => {
        wx.hideLoading();
        if (res.result.success) {
          wx.showToast({ title: "提现申请已提交", icon: "success" });
          this.closeWithdrawModal();
          this.loadGroupLeaderData(); // 刷新数据
        } else {
          wx.showToast({ title: res.result.msg || "提交失败", icon: "none" });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        wx.showToast({ title: "提交失败", icon: "none" });
        console.error("提现申请失败：", err);
      }
    });
  }
});