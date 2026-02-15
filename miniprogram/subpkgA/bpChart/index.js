const wxCharts = require('../../utils/wxcharts.js');

Page({
  data: {
    isEmpty: false,
    mode: '7', // 默认最近7天
    modeText: {
      '7': '最近7天',
      '15': '最近15天'
    }
  },

  onReady() {
    this.loadDataAndDraw();
  },

  // 切换模式
  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ mode });
    this.loadDataAndDraw();
  },

  async loadDataAndDraw() {
    const app = getApp();
    const openid = app.globalData.openid;
    const db = wx.cloud.database();
    const mode = this.data.mode;

    try {
      const now = new Date();
      const days = mode === '7' ? 7 : 15;
      const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      const res = await db.collection('bloodPressure')
        .where({
          _openid: openid,
          recordTime: db.command.gte(startDate)
        })
        .orderBy('recordTime', 'asc')
        .get();

      if (!res.data.length) {
        this.setData({ isEmpty: true });
        return;
      }
      this.setData({ isEmpty: false });

      const xData = res.data.map(item => item.date.slice(5));
      const highData = res.data.map(item => item.high);
      const lowData = res.data.map(item => item.low);

      this.drawChart(xData, highData, lowData);
    } catch (err) {
      console.error(err);
      this.setData({ isEmpty: true });
    }
  },

  drawChart(xData, highData, lowData) {
    const systemInfo = wx.getWindowInfo();
    const canvasWidth = systemInfo.windowWidth;

    new wxCharts({
      canvasId: 'bpCanvas', // 注意：这里要和wxml里的canvas-id一致
      type: 'line',
      categories: xData,
      series: [
        {
          name: '高压',
          data: highData,
          color: '#ff4d4f'
        },
        {
          name: '低压',
          data: lowData,
          color: '#1890ff'
        }
      ],
      yAxis: {
        min: 60,
        max: 200,
        title: '值(mmHg)'
      },
      width: canvasWidth,
      height: 200,
      dataLabel: true,
      legend: true,
      smooth: true
    });
  }
});