// Cloud connectivity gates writes, never browsing or competition navigation.
export function interactionState({ authenticated, cloudLoaded, busy }) {
  const canEdit = Boolean(authenticated && cloudLoaded && !busy);
  const mode = busy ? '正在处理数据' : !authenticated ? '只读模式' : cloudLoaded ? '可编辑' : '已解锁 · 等待云端';
  const notice = busy ? '正在导入或恢复数据，请稍候。'
    : !cloudLoaded ? '尚未连接云端，当前显示本机缓存或初始预览。可切换赛事、查看和导出；连接成功并输入口令后可编辑。'
    : !authenticated ? '当前为只读模式，可查看和导出积分榜。点击右上角“口令登录”后可修改数据。' : '';
  return { canEdit, browseBlocked: Boolean(busy), mode, notice };
}
