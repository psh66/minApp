const app = getApp();
const db = wx.cloud.database();
const _ = db.command;

// 集合名严格匹配你的数据库
const groupLeaderCol = db.collection("groupLeader");
const rewardRecordsCol = db.collection("rewardRecords");
const withdrawRecordsCol = db.collection("withdrawRecord"); // 不带s

// 时间格式化工具函数
const formatTime = (date) => {
  if (!date) return "未知时间";
  const d = new Date(date);
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  const hour = d.getHours().toString().padStart(2, "0");
  const minute = d.getMinutes().toString().padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
};

Page({
  data: {
    groupLeaderData: {
      pendingReward: 0, // 待结算收益
      withdrawAble: 0, // 可提现金额（原字段）
      totalOrder: 0, // 总订单数
      totalWithdrawn: 0, // 已提现金额（已到账）
      pendingWithdraw: 0, // 新增：审核中提现金额
    },
    rewardRecords: [],
    withdrawRecords: [],
    showWithdrawModal: false,
    withdrawAmount: "",
    payeeInfo: { wechatName: "" },
    qrcodeUrl: "",
  },

  onLoad() {
    // 打印当前登录用户openid，方便排查匹配问题
    console.log("当前登录用户openid：", app.globalData.openid);
    if (app.globalData.openid) {
      this.loadGroupLeaderData();
    } else {
      wx.cloud.callFunction({
        name: "login",
        success: (res) => {
          app.globalData.openid = res.result.openid;
          this.loadGroupLeaderData();
        },
        fail: (err) => {
          wx.showToast({ title: "获取用户信息失败", icon: "none" });
          console.error("登录失败：", err);
        },
      });
    }
  },

  // 核心：加载团长所有数据（修正金额读取逻辑）
  async loadGroupLeaderData() {
    const targetOpenid = app.globalData.openid;
    if (!targetOpenid) {
      wx.showToast({ title: "未获取到用户信息", icon: "none" });
      return;
    }

    try {
      // 1. 查询团长基础信息
      const leaderRes = await groupLeaderCol
        .where({ leaderOpenid: targetOpenid })
        .get({ forceServer: true });
      let leaderData = {
        pendingReward: 0,
        withdrawAble: 0,
        totalOrder: 0,
        totalCommission: 0,
        totalWithdrawn: 0,
        pendingWithdraw: 0,
        leaderOpenid: targetOpenid,
      };

      if (leaderRes.data && leaderRes.data.length > 0) {
        leaderData = {
          ...leaderRes.data[0],
          // 直接读取数据库字段，不重新计算
          pendingReward: leaderRes.data[0].pendingReward || 0,
          withdrawAble: leaderRes.data[0].withdrawAble || 0,
          totalOrder: leaderRes.data[0].totalOrder || 0,
          totalCommission: leaderRes.data[0].totalCommission || 0,
          totalWithdrawn: leaderRes.data[0].totalWithdrawn || 0,
          pendingWithdraw: leaderRes.data[0].pendingWithdraw || 0,
        };
      }

      // 2. 查询推广记录并格式化时间
      const rewardRes = await rewardRecordsCol
        .where({ leaderOpenid: targetOpenid })
        .orderBy("createTime", "desc")
        .get({ forceServer: true })
        .catch(() => ({ data: [] }));

      const rewardList = [];
      for (const item of rewardRes.data || []) {
        let userName = "未知用户";
        let settleStatus = "未结算";
        try {
          const userRes = await db
            .collection("users")
            .where({ _openid: item.userOpenid })
            .get();
          if (userRes.data && userRes.data.length > 0) {
            const user = userRes.data[0];
            const originalName = user.name || "未设置姓名";
            userName =
              originalName.length >= 2
                ? originalName[0] + "**"
                : originalName + "**";
          } else {
            userName = `用户(${item.userOpenid.slice(-6)})`;
          }

          if (item.settleStatus) {
            settleStatus =
              item.settleStatus === "settled" ? "已结算" : "未结算";
          } else {
            const isSettled =
              leaderData.pendingReward === 0 &&
              leaderData.withdrawAble >= (item.rewardAmount || 0);
            settleStatus = isSettled ? "已结算" : "未结算";
          }
        } catch (e) {
          console.error("查询用户信息/结算状态失败：", e);
          userName = `用户(${item.userOpenid.slice(-6)})`;
        }

        rewardList.push({
          ...item,
          formatTime: formatTime(item.createTime),
          userName: userName,
          settleStatus: settleStatus,
        });
      }

      // 3. 查询提现记录并格式化时间
      const withdrawRes = await withdrawRecordsCol
        .where({ leaderOpenid: targetOpenid })
        .orderBy("createTime", "desc")
        .get({ forceServer: true })
        .catch(() => ({ data: [] }));
      const withdrawList = (withdrawRes.data || []).map((item) => ({
        ...item,
        formatTime: formatTime(item.createTime),
        status: item.status || "pending",
      }));

      // 4. 赋值渲染页面（不再重新计算金额，直接用数据库里的最新值）
      this.setData({
        groupLeaderData: leaderData,
        rewardRecords: rewardList,
        withdrawRecords: withdrawList,
      });

      console.log("✅ 团长数据加载成功：", leaderData);
    } catch (err) {
      console.error("加载团长数据失败：", err);
      wx.showToast({ title: "数据加载失败", icon: "none" });
    }
  },

  // 结算：待结算收益 → 可提现金额（保留原有逻辑）
  // 结算：待结算收益 → 可提现金额（补充更新推广订单的结算状态）
  async settleToWithdraw() {
    const openid = app.globalData.openid;
    const leaderData = this.data.groupLeaderData;
    const pending = leaderData.pendingReward || 0;

    if (pending <= 0) {
      wx.showToast({ title: "暂无待结算收益", icon: "none" });
      return;
    }

    wx.showModal({
      title: "确认结算",
      content: `是否将 ${pending} 元待结算收益转入可提现金额？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            wx.showLoading({ title: "结算中..." });

            // 1. 先更新推广订单状态
            await rewardRecordsCol
              .where({
                leaderOpenid: openid,
                settleStatus: "unsettled",
              })
              .update({
                data: {
                  settleStatus: "settled",
                  settleTime: db.serverDate(),
                  updateTime: db.serverDate(),
                },
              });

            // 2. 再更新团长金额，确保操作成功
            const updateRes = await groupLeaderCol.doc(leaderData._id).update({
              data: {
                pendingReward: 0,
                withdrawAble: _.inc(pending),
                updateTime: db.serverDate(),
              },
            });

            console.log("金额更新结果：", updateRes);

            wx.hideLoading();
            wx.showToast({ title: "结算成功" });

            // 强制延迟刷新，确保数据库写入完成
            setTimeout(() => {
              this.loadGroupLeaderData();
            }, 1000);
          } catch (err) {
            wx.hideLoading();
            console.error("结算失败：", err);
            wx.showToast({ title: "结算失败：" + err.errMsg, icon: "none" });
          }
        }
      },
    });
  },

  // 分享按钮点击
  shareToFriend() {
    wx.showToast({ title: "点击右上角转发", icon: "none" });
  },

  // 小程序原生分享
  onShareAppMessage() {
    return {
      title: "父母平安签，子女远程守护！",
      path: `/pages/index/index?leaderOpenid=${app.globalData.openid}`,
      imageUrl: "../../images/001.jpg", // 确保图片路径正确
    };
  },

  // 打开提现弹窗（新增：计算真实可提现金额）
  showWithdrawModal() {
    const { withdrawAble, pendingWithdraw } = this.data.groupLeaderData;
    // 真实可提现 = 可提现金额 - 审核中金额
    const realAvailable = withdrawAble - pendingWithdraw;

    if (realAvailable < 1) {
      wx.showToast({
        title: `当前可提现 ${realAvailable} 元（含审核中 ${pendingWithdraw} 元）`,
        icon: "none",
        duration: 2000,
      });
      return;
    }
    this.setData({
      showWithdrawModal: true,
      withdrawAmount: realAvailable + "", // 默认填真实可提现金额
      payeeInfo: { wechatName: "" },
      qrcodeUrl: "",
    });
  },

  // 关闭提现弹窗
  closeWithdrawModal() {
    this.setData({ showWithdrawModal: false });
  },

  // 绑定提现金额输入
  bindWithdrawAmount(e) {
    this.setData({ withdrawAmount: e.detail.value });
  },

  // 绑定微信昵称输入
  bindWechatName(e) {
    this.setData({ "payeeInfo.wechatName": e.detail.value });
  },

  // 选择收款码图片
  chooseQrcode() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (res) => {
        this.setData({ qrcodeUrl: res.tempFiles[0].tempFilePath });
      },
      fail: () => {
        wx.showToast({ title: "选择图片失败", icon: "none" });
      },
    });
  },

  // 提交提现申请（核心修复：增加审核中金额校验）
  async submitWithdraw() {
    const { withdrawAmount, payeeInfo, qrcodeUrl, groupLeaderData } = this.data;
    const amount = Number(withdrawAmount);
    const openid = app.globalData.openid;
    const { withdrawAble, pendingWithdraw, _id } = groupLeaderData;

    // 真实可提现金额 = 可提现金额 - 审核中金额
    const realAvailable = withdrawAble - pendingWithdraw;

    // 增强校验
    if (isNaN(amount) || amount < 1) {
      wx.showToast({ title: "请输入≥1元的提现金额", icon: "none" });
      return;
    }
    if (amount > realAvailable) {
      wx.showToast({
        title: `提现金额不能超过 ${realAvailable} 元（含审核中 ${pendingWithdraw} 元）`,
        icon: "none",
        duration: 2000,
      });
      return;
    }
    if (!payeeInfo.wechatName || payeeInfo.wechatName.trim() === "") {
      wx.showToast({ title: "请填写微信昵称", icon: "none" });
      return;
    }
    if (!qrcodeUrl) {
      wx.showToast({ title: "请上传收款码", icon: "none" });
      return;
    }

    wx.showLoading({ title: "提交中..." });
    try {
      // 1. 上传收款码到云存储
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `withdraw/${openid}_${Date.now()}.png`,
        filePath: qrcodeUrl,
      });

      // 2. 写入提现记录
      await withdrawRecordsCol.add({
        data: {
          leaderOpenid: openid,
          amount: amount,
          payeeInfo: {
            wechatName: payeeInfo.wechatName.trim(),
            qrcodeFileID: uploadRes.fileID,
          },
          status: "pending", // 初始状态：审核中
          createTime: db.serverDate(),
        },
      });

      // 3. 扣减可提现金额 + 更新审核中金额
      await groupLeaderCol.doc(_id).update({
        data: {
          withdrawAble: _.inc(-amount),
          pendingWithdraw: _.inc(amount), // 审核中金额同步增加
          updateTime: db.serverDate(),
        },
      });

      wx.hideLoading();
      wx.showToast({ title: "提现申请已提交" });
      this.setData({ showWithdrawModal: false });
      this.loadGroupLeaderData(); // 重新加载数据
    } catch (err) {
      wx.hideLoading();
      console.error("提现申请失败：", err);
      wx.showToast({ title: "提交失败，请重试", icon: "none" });
    }
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.loadGroupLeaderData();
    setTimeout(() => {
      wx.stopPullDownRefresh();
    }, 800);
  },

  // 页面显示时重新加载数据
  onShow() {
    if (app.globalData.openid) {
      this.loadGroupLeaderData();
    }
  },
});
