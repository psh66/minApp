const app = getApp();
const db = wx.cloud.database();

Page({
  data: {
    pendingReward: 0,
    withdrawAble: 0,
    totalOrder: 0,
    orderList: [],
    withdrawRecords: [],
    showModal: false,
    withdrawForm: {
      amount: "",
      payeeInfo: "",
    },
  },

  onLoad() {
    this.loadLeaderData();
  },

  onShow() {
    this.loadLeaderData();
  },

  onPullDownRefresh() {
    this.loadLeaderData(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 加载团长数据
  async loadLeaderData(callback) {
    wx.showLoading({ title: "加载中..." });
    try {
      const res = await wx.cloud.callFunction({
        name: "groupLeader",
        data: {
          action: "getData",
          openid: app.globalData.openid,
        },
      });

      if (res.success) {
        this.setData({
          pendingReward: res.data.pendingReward || 0,
          withdrawAble: res.data.withdrawAble || 0,
          totalOrder: res.data.totalOrder || 0,
          orderList: res.orderList || [],
          withdrawRecords: res.withdrawRecords || [],
        });
      }
    } catch (err) {
      console.error("加载团长数据失败", err);
      wx.showToast({ title: "加载失败", icon: "none" });
    } finally {
      wx.hideLoading();
      callback && callback();
    }
  },

  // 复制推广链接
  copyLink() {
    const shareUrl = `https://你的小程序链接?leader=${app.globalData.openid}`;
    wx.setClipboardData({
      data: shareUrl,
      success: () => {
        wx.showToast({ title: "推广链接已复制" });
      },
    });
  },

  // 生成推广海报
  generatePoster() {
    wx.showToast({ title: "生成中...", icon: "loading" });
    // 这里可以接入生成海报的云函数
    setTimeout(() => {
      wx.showToast({ title: "海报生成成功" });
    }, 1500);
  },

  // 显示提现弹窗
  showWithdrawModal() {
    if (this.data.withdrawAble < 1) {
      wx.showToast({ title: "满1元可提现", icon: "none" });
      return;
    }
    this.setData({ showModal: true });
  },

  // 隐藏提现弹窗
  hideModal() {
    this.setData({
      showModal: false,
      "withdrawForm.amount": "",
      "withdrawForm.payeeInfo": "",
    });
  },

  // 阻止弹窗事件冒泡
  stopPropagation() {},

  // 金额输入
  onAmountInput(e) {
    this.setData({
      "withdrawForm.amount": e.detail.value,
    });
  },

  // 收款信息输入
  onPayeeInfoInput(e) {
    this.setData({
      "withdrawForm.payeeInfo": e.detail.value,
    });
  },

  // 申请提现
  async applyWithdraw() {
    const { withdrawForm, withdrawAble } = this.data;
    const amount = Number(withdrawForm.amount);

    // 校验
    if (!amount || amount < 1) {
      wx.showToast({ title: "请输入有效金额", icon: "none" });
      return;
    }
    if (amount > withdrawAble) {
      wx.showToast({ title: "提现金额超出可提现余额", icon: "none" });
      return;
    }
    if (!withdrawForm.payeeInfo.trim()) {
      wx.showToast({ title: "请填写微信收款码/微信号", icon: "none" });
      return;
    }

    wx.showModal({
      title: "确认提现",
      content: `确认提现${amount}元？`,
      async success(res) {
        if (res.confirm) {
          wx.showLoading({ title: "提交中..." });
          try {
            const res = await wx.cloud.callFunction({
              name: "groupLeader",
              data: {
                action: "applyWithdraw",
                openid: app.globalData.openid,
                amount,
                payeeInfo: withdrawForm.payeeInfo,
              },
            });

            if (res.success) {
              wx.showToast({ title: "申请提交成功，等待审核" });
              this.hideModal();
              this.loadLeaderData();
            } else {
              wx.showToast({ title: res.msg || "提交失败", icon: "none" });
            }
          } catch (err) {
            console.error("提现申请失败", err);
            wx.showToast({ title: "提交失败", icon: "none" });
          } finally {
            wx.hideLoading();
          }
        }
      },
    });
  },
});
