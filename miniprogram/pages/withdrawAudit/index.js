const app = getApp();
const db = wx.cloud.database();

Page({
  data: {
    loading: false,
    recordList: [],
    currentStatus: "all",
    statusList: ["all", "pending", "success", "fail"],
    statusMap: {
      pending: "审核中",
      success: "已打款",
      fail: "已驳回",
    },
  },

  onLoad() {
    this.getWithdrawList();
  },

  onShow() {
    this.getWithdrawList();
  },

  // 切换状态筛选
  switchStatus(e) {
    const status = e.currentTarget.dataset.status;
    this.setData({ currentStatus: status }, () => {
      this.getWithdrawList();
    });
  },

  // 获取提现记录
  async getWithdrawList() {
    this.setData({ loading: true });
    try {
      const { currentStatus } = this.data;
      let whereCond = {};
      if (currentStatus !== "all") {
        whereCond.status = currentStatus;
      }

      const res = await db
        .collection("withdrawRecord")
        .where(whereCond)
        .orderBy("createTime", "desc")
        .get();

      this.setData({
        recordList: res.data || [],
        loading: false,
      });
    } catch (err) {
      console.error("获取提现记录失败", err);
      this.setData({ loading: false });
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },

  // 审核操作：通过/驳回
  async auditHandle(e) {
    const type = e.currentTarget.dataset.type;
    const recordId = e.currentTarget.dataset.id;
    const leaderOpenid = e.currentTarget.dataset.leaderopenid;
    const amount = Number(e.currentTarget.dataset.amount);

    let title = "";
    let content = "";
    if (type === "pass") {
      title = "确认打款";
      content = `确认已向该团长转账 ${amount} 元？\n审核通过后记录状态改为已打款`;
    } else {
      title = "确认驳回";
      content = `确认驳回该提现申请？\n驳回后金额将退回团长可提现余额`;
    }

    wx.showModal({
      title,
      content,
      confirmText: "确定",
      cancelText: "取消",
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: "处理中..." });

        try {
          if (type === "pass") {
            // 审核通过：仅更新状态为已打款
            await db
              .collection("withdrawRecord")
              .doc(recordId)
              .update({
                data: {
                  status: "success",
                  auditTime: db.serverDate(),
                },
              });
            wx.showToast({ title: "已标记为已打款" });
          } else {
            // 驳回：1.更新记录状态 2.金额退回团长可提现余额
            await db
              .collection("withdrawRecord")
              .doc(recordId)
              .update({
                data: {
                  status: "fail",
                  auditTime: db.serverDate(),
                },
              });
            // 金额退回团长余额
            await db
              .collection("groupLeader")
              .where({ leaderOpenid })
              .update({
                data: {
                  withdrawAble: db.command.inc(amount),
                },
              });
            wx.showToast({ title: "已驳回，金额已退回" });
          }
          // 刷新列表
          this.getWithdrawList();
        } catch (err) {
          console.error("审核处理失败", err);
          wx.showToast({ title: "处理失败", icon: "none" });
        } finally {
          wx.hideLoading();
        }
      },
    });
  },
});
