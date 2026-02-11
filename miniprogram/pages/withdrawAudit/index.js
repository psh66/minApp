const app = getApp();
const db = wx.cloud.database();
// 定义集合常量，和团长页/联系人页风格统一
const withdrawRecordCol = db.collection("withdrawRecord");
const groupLeaderCol = db.collection("groupLeader");
// 引入数据库指令（处理金额增减）
const _ = db.command;

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

  // 切换状态筛选（原有逻辑不变）
  switchStatus(e) {
    const status = e.currentTarget.dataset.status;
    this.setData({ currentStatus: status }, () => {
      this.getWithdrawList();
    });
  },

  // 获取提现记录：统一风格+精准查询+强化容错
  async getWithdrawList() {
    this.setData({ loading: true });
    try {
      const { currentStatus } = this.data;
      let whereCond = {};

      // 1. 【可选】如果是按当前登录团长筛选，补充_openid精准查询（和联系人页一致）
      // if (app.globalData.openid) {
      //   whereCond._openid = app.globalData.openid;
      // }

      // 2. 状态筛选（原有逻辑）
      if (currentStatus !== "all") {
        whereCond.status = currentStatus;
      }

      // 3. 统一查询写法：和团长页/联系人页一致，加forceServer防缓存
      const res = await withdrawRecordCol
        .where(whereCond)
        .orderBy("createTime", "desc")
        .get({ forceServer: true });

      // 4. 强化格式化+容错（原有逻辑优化）
      const recordList = (res.data || []).map((item) => ({
        ...item,
        formatCreateTime: item.createTime
          ? new Date(item.createTime).toLocaleString("zh-CN", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "暂无时间",
        payeeInfo: item.payeeInfo || { wechatName: "未填写", qrcodeFileID: "" },
        // 兜底空值：防止leaderOpenid/amount为空导致审核报错
        leaderOpenid: item.leaderOpenid || "",
        amount: Number(item.amount) || 0,
      }));

      this.setData({
        recordList: recordList,
        loading: false,
      });
    } catch (err) {
      console.error("获取提现记录失败", err);
      this.setData({ loading: false });
      // 精准异常提示（和团长页/联系人页一致）
      if (err.errMsg.includes("permission denied")) {
        wx.showToast({ title: "无权限查看提现记录", icon: "none" });
      } else {
        wx.showToast({ title: "加载失败", icon: "none" });
      }
    }
  },

  // 预览收款码图片（原有逻辑+强化容错）
  previewQrcode(e) {
    const qrcodeFileID = e.currentTarget.dataset.qrcode;
    if (!qrcodeFileID) {
      wx.showToast({ title: "暂无收款码", icon: "none" });
      return;
    }
    // 补充云存储图片预览的容错处理
    wx.previewImage({
      current: qrcodeFileID,
      urls: [qrcodeFileID],
      fail: () => {
        wx.showToast({ title: "预览失败，请重试", icon: "none" });
      },
    });
  },

  // 审核操作：修复关键bug+统一风格
  async auditHandle(e) {
    const type = e.currentTarget.dataset.type;
    const recordId = e.currentTarget.dataset.id;
    const leaderOpenid = e.currentTarget.dataset.leaderopenid;
    const amount = Number(e.currentTarget.dataset.amount);

    // 前置校验：防止空值导致后续操作报错
    if (!recordId || !leaderOpenid || amount <= 0) {
      wx.showToast({ title: "数据异常，无法操作", icon: "none" });
      return;
    }

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
          // 1. 更新提现记录状态（原有逻辑）
          await withdrawRecordCol.doc(recordId).update({
            data: {
              status: type === "pass" ? "success" : "fail",
              auditTime: db.serverDate(),
            },
          });

          // 2. 驳回时退回金额：修复关键bug（where条件从leaderOpenid改为doc精准查询）
          if (type === "fail") {
            // 原写法：where({ leaderOpenid }) → 可能匹配多条，风险高
            // 优化：doc(leaderOpenid) 精准更新（和团长页查询逻辑一致）
            await groupLeaderCol.doc(leaderOpenid).update({
              data: {
                withdrawAble: _.inc(amount), // 使用引入的_指令，更规范
              },
            });
          }

          wx.showToast({
            title: type === "pass" ? "已标记为已打款" : "已驳回，金额已退回",
          });
          this.getWithdrawList(); // 刷新列表
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
