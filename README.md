# 交互设计界面

“儿童眼中的世界”是一个关于厌童议题的浏览器交互体验，基于 Vite、Three.js 和 MediaPipe 开发。用户可以通过摄像头手势选择四个公共场景，并在全屏视频中移动局部视觉范围；麦克风输入用于实时影响原始环境声音的处理强度。

## 本地运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

## 发布到 GitHub Pages

1. 在 GitHub 创建一个公开仓库，不要勾选自动生成 README。
2. 在本项目目录初始化 Git，并将代码推送到仓库的 `main` 分支。
3. 打开仓库的 `Settings > Pages`，在 `Build and deployment` 中选择 `GitHub Actions`。
4. 等待 `Deploy website to GitHub Pages` 工作流完成。

公开网址通常为：

```text
https://3032512167-cyber.github.io/child-vision-interactive-design/
```

摄像头和麦克风只能在 HTTPS 或本机地址中使用。GitHub Pages 默认提供 HTTPS。

## 免费正式域名方案

如果你想要更像正式网站、又不想先买域名，推荐使用 `is-a.dev` 免费子域名。

我已经把站点预设为：

```text
vision-interactive.is-a.dev
```

接入步骤：

1. 去 `is-a.dev/register` 提交一个同名 JSON 文件，例如 `vision-interactive.json`。
2. 记录里把 `CNAME` 指向你的 GitHub Pages 默认域名，通常是 `3032512167-cyber.github.io`。
3. 在当前仓库的 `Settings > Pages` 里把 `Custom domain` 填成 `vision-interactive.is-a.dev`。
4. 等待 GitHub 自动签发 HTTPS。

绑定成功后，你的公开网址会变成：

```text
https://vision-interactive.is-a.dev/
```

## 隐私

摄像头画面和麦克风音量仅在访问者浏览器中实时处理，不上传到服务器。视频和图片作为静态资源随网页发布。

## 发布前检查

- 确认所有视频、图片和字体拥有公开展示与再分发许可。
- 不要提交 API Key、`.env`、本机 DOCX 凭据文档或生成服务配置。
- 如果希望他人可以复用代码，请在确认媒体授权后添加适合的开源许可证，例如 MIT。
