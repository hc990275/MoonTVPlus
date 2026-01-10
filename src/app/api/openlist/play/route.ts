/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { OpenListClient } from '@/lib/openlist.client';

export const runtime = 'nodejs';

/**
 * GET /api/openlist/play?folder=xxx&fileName=xxx
 * 获取单个视频文件的播放链接（懒加载）
 * 返回重定向到真实播放 URL
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const folderName = searchParams.get('folder');
    const fileName = searchParams.get('fileName');

    if (!folderName || !fileName) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const config = await getConfig();
    const openListConfig = config.OpenListConfig;

    if (
      !openListConfig ||
      !openListConfig.Enabled ||
      !openListConfig.URL ||
      !openListConfig.Username ||
      !openListConfig.Password
    ) {
      return NextResponse.json({ error: 'OpenList 未配置或未启用' }, { status: 400 });
    }

    // folderName 已经是完整路径，直接使用
    const folderPath = folderName;
    const filePath = `${folderPath}/${fileName}`;

    const client = new OpenListClient(
      openListConfig.URL,
      openListConfig.Username,
      openListConfig.Password
    );

    // 获取文件的播放链接
    const fileResponse = await client.getFile(filePath);

    if (fileResponse.code !== 200 || !fileResponse.data.raw_url) {
      console.error('[OpenList Play] 获取播放URL失败:', {
        fileName,
        code: fileResponse.code,
        message: fileResponse.message,
      });
      return NextResponse.json(
        { error: '获取播放链接失败' },
        { status: 500 }
      );
    }

    // 返回重定向到真实播放 URL
    return NextResponse.redirect(fileResponse.data.raw_url);
  } catch (error) {
    console.error('获取播放链接失败:', error);
    return NextResponse.json(
      { error: '获取失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}