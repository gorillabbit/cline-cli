import * as path from "path"
import * as fs from "fs/promises"
import { createDirectoriesForFile } from "../../utils/fs.js" // ファイル用ユーティリティ（必要に応じて実装してください）
import { formatResponse } from "../../prompts/responses.js"

/**
 * GenericDiffProvider クラス
 * VSCode 依存の機能を使わずに、ファイルの変更差分の管理・保存・リバートを行うための汎用クラスです。
 */
export class GenericDiffProvider {
  // 編集タイプ: "create"（新規作成）または "modify"（変更）
  editType?: "create" | "modify"
  // 編集中かどうかのフラグ
  isEditing = false
  // 編集前のオリジナルコンテンツ
  originalContent: string | undefined
  // 新規作成時に生成したディレクトリ一覧（必要に応じて後で削除する）
  private createdDirs: string[] = []
  // 編集対象の相対パス
  private relPath?: string
  // 編集後の新しいコンテンツ（内部状態）
  private newContent?: string
  // ストリーミングされた行の配列
  private streamedLines: string[] = []

  constructor(private cwd: string) {}

  /**
   * 指定された相対パスのファイルをオープンし、編集の準備をする
   * VSCode のエディタ表示機能は使わず、ファイル内容の読み込みとディレクトリ作成のみを行います。
   * @param relPath 編集対象の相対パス
   */
  async open(relPath: string): Promise<void> {
    this.relPath = relPath
    const fileExists = this.editType === "modify"
    const absolutePath = path.resolve(this.cwd, relPath)
    this.isEditing = true

    // ファイルが存在する場合は、オリジナルの内容を読み込む
    if (fileExists) {
      this.originalContent = await fs.readFile(absolutePath, "utf-8")
    } else {
      this.originalContent = ""
    }

    // 新規ファイルの場合、必要なディレクトリを作成する
    this.createdDirs = await createDirectoriesForFile(absolutePath)
    if (!fileExists) {
      await fs.writeFile(absolutePath, "")
    }

    // VSCode のタブ操作やエディタ表示に関する処理は、汎用実装では困難なためコメントアウト
    // 例: 「既にファイルが開いている場合は閉じる」などの処理

    // ストリーミング用の初期状態として、空の配列をセット
    this.streamedLines = []
  }

  /**
   * ストリーミングで更新された内容を内部状態に反映するとともに、
   * ファイルの内容も更新する処理です。
   *
   * ※エディタ上の逐次更新処理（カーソル移動、装飾、スクロールなど）は VSCode 固有のため、ここではファイル内容の更新のみ行います。
   *
   * @param accumulatedContent 現在までの全更新済みの内容
   * @param isFinal 最終更新かどうかのフラグ
   */
  async update(accumulatedContent: string, isFinal: boolean): Promise<void> {
    if (!this.relPath) {
      throw new Error("ファイルのパスが設定されていません。")
    }
    this.newContent = accumulatedContent

    // 改行で分割し、各行の配列にする
    const accumulatedLines = accumulatedContent.split("\n")
    // 新しく更新された内容を内部状態に保持する
    this.streamedLines = accumulatedLines

    // ここでファイルの内容も更新します。
    // ※リアルタイムに1行ずつ更新する場合は、差分計算や部分更新が必要ですが、
    //    汎用実装では accumulatedContent 全体でファイルを書き換える処理としています。
    const absolutePath = path.resolve(this.cwd, this.relPath)
    await fs.writeFile(absolutePath, accumulatedLines.join("\n"), "utf8")

    // VSCode のエディタ上での各行更新や装飾処理は実現が困難なため、以下はコメントアウト
    /*
    for (let i = 0; i < diffLines.length; i++) {
      // エディタ上で内容を逐次更新し、カーソルや装飾を変更する処理
      // ここは VSCode の API を使って実装する必要があります。
    }
    */
  }

  /**
   * 変更内容を保存し、差分パッチなどの情報を返す
   * VSCode 固有のエディタ操作（自動整形など）は利用せず、ファイル上の更新内容を反映します。
   */
  async saveChanges(): Promise<{
    userEdits: string | undefined
    autoFormattingEdits: string | undefined
    finalContent: string | undefined
  }> {
    if (!this.relPath || !this.newContent) {
      return {
        userEdits: undefined,
        autoFormattingEdits: undefined,
        finalContent: undefined,
      }
    }
    const absolutePath = path.resolve(this.cwd, this.relPath)

    // 現在の編集内容（newContent）を保存する
    // ※ここでは自動整形など VSCode 固有の処理は行わず、そのまま書き込みます
    await fs.writeFile(absolutePath, this.newContent, "utf8")

    // 保存後の内容を読み込む
    const postSaveContent = await fs.readFile(absolutePath, "utf8")

    // 改行コードの統一処理（必要に応じて実施）
    const newContentEOL = this.newContent.includes("\r\n") ? "\r\n" : "\n"
    const normalizedNewContent = this.newContent.replace(/\r\n|\n/g, newContentEOL).trimEnd() + newContentEOL
    const normalizedPostSaveContent = postSaveContent.replace(/\r\n|\n/g, newContentEOL).trimEnd() + newContentEOL

    let userEdits: string | undefined
    if (normalizedNewContent !== normalizedPostSaveContent) {
      // ユーザーが編集前に変更を加えた場合の差分パッチ（VSCode の自動整形前後の差分がない前提）
      userEdits = formatResponse.createPrettyPatch(this.relPath.replace(/\\/g, "/"), normalizedNewContent, normalizedPostSaveContent)
    }

    // VSCode の自動整形処理に伴う差分は、この汎用実装では対象外とする
    const autoFormattingEdits: string | undefined = undefined

    return {
      userEdits,
      autoFormattingEdits,
      finalContent: normalizedPostSaveContent,
    }
  }

  /**
   * 編集をリバート（キャンセル）する
   * 新規作成の場合は、作成したファイルとディレクトリを削除します。
   */
  async revertChanges(): Promise<void> {
    if (!this.relPath) {
      return
    }
    const fileExists = this.editType === "modify"
    const absolutePath = path.resolve(this.cwd, this.relPath)
    if (!fileExists) {
      // 新規作成されたファイルの場合、ファイルを削除
      await fs.unlink(absolutePath)
      // 作成されたディレクトリを逆順に削除する
      for (let i = this.createdDirs.length - 1; i >= 0; i--) {
        await fs.rmdir(this.createdDirs[i])
        console.log(`Directory ${this.createdDirs[i]} has been deleted.`)
      }
      console.log(`File ${absolutePath} has been deleted.`)
    } else {
      // 既存ファイルの場合、元の内容に戻す
      if (this.originalContent !== undefined) {
        await fs.writeFile(absolutePath, this.originalContent, "utf8")
        console.log(`File ${absolutePath} has been reverted to its original content.`)
      }
    }
    // リセット処理
    await this.reset()
  }

  /**
   * 内部状態をリセットする
   */
  async reset() {
    this.editType = undefined
    this.isEditing = false
    this.originalContent = undefined
    this.createdDirs = []
    this.relPath = undefined
    this.newContent = undefined
    this.streamedLines = []
  }

  // --- 以下、VSCode 固有の処理は実装困難なため、汎用実装では省略またはコメントアウト ---

  /*
  // エディタ上にスクロールする処理
  private scrollEditorToLine(line: number) {
    // VSCode の API を利用しない場合、ターミナル出力などで代替する必要があります。
  }

  // Diff エディタを開く処理
  private async openDiffEditor(): Promise<any> {
    // VSCode の diff 表示機能は利用できないため、代替の UI 実装が必要です。
    throw new Error("Diff エディタのオープンは VSCode 固有の機能のため、実装できません。")
  }
  */
}
