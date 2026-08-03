<template>
  <view class="page">
    <web-view src="/hybrid/html/night-mailbox-app.html"></web-view>
  </view>
</template>

<script>
/**
 * 极简 App 壳：只加载安装包内置的纯前端 H5。
 * API、数据和图片任务全部由 H5 在当前设备处理，不再连接电脑 Node 服务。
 */
export default {};
</script>

<style>
page,
.page {
  width: 100%;
  min-height: 100%;
  background: #12131d;
}

.page {
  min-height: 100vh;
}
</style>
