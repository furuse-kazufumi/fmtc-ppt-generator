# No.1 共通データ形式・規約の整備（JSON等）— 討論用資料

## 背景・課題・ゴール

**なぜ今やるのか**

多くの後続テーマ（AI検査・RAG・エッジ配信・レシピ管理）が「データをJSON等の統一形式で持つ」ことを暗黙の前提にしている。ここを固めないと後続が動き出せない。新人でも着手でき、整備自体が成果物になる土台プロジェクト。

### プロジェクトゴール

| 項目 | 内容 |
|------|------|
| 期間 | 3ヶ月（PoC 1ヶ月 → 試行導入 1ヶ月 → 展開 1ヶ月） |
| 成果物 | JSON Schema定義ファイル群・バリデーションライブラリ・運用ガイド |
| 対象 | 検査結果・装置設定・計測データの3種類から着手 |
| 担当 | 新人1名（主担当）＋ベテランレビュー（週1時間） |

### 対象データ優先順位

| 優先度 | データ種別 | 後続テーマへの波及 |
|--------|-----------|------------------|
| 高 | 検査結果（合否・座標・信頼度） | No.17・No.37・No.46 |
| 高 | 装置設定（撮像条件・レシピ） | No.16直結 |
| 中 | 計測データ（時系列センサ値） | No.22・No.30 |
| 低 | ログ・イベント | 後回し可 |

---

## JSON Schema 基礎知識

**JSON Schema Draft 2020-12** を採用。VSCode標準サポート・Python(pydantic v2)・各種バリデーターが対応済み。

### スキーマ構造の例（検査結果 v1.0.0）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id":     "schemas/inspection_result/v1.0.0.schema.json",
  "type":    "object",
  "required": ["schema_version","timestamp","device_id","result"],
  "properties": {
    "schema_version": { "const": "1.0.0" },
    "timestamp":      { "type": "string", "format": "date-time" },
    "device_id":      { "type": "string", "pattern": "^[A-Z]{3}-[0-9]{4}$" },
    "result":         { "enum": ["OK","NG","UNKNOWN"] },
    "confidence":     { "type": "number", "minimum": 0.0, "maximum": 1.0 },
    "ng_categories":  { "type": "array",  "items": { "type": "string" } }
  },
  "unevaluatedProperties": false
}
```

### 設計の要点

- `unevaluatedProperties: false` → タイポによる未定義フィールドを自動検出
- `const` でスキーマバージョンをデータ内に埋め込み → 版と一体管理
- `confidence` は 0.0〜1.0 に統一（%表記禁止をスキーマで強制）
- `if/then` で result=NG のとき ng_categories を必須化可能

---

## PoC手順書 Step 1〜2：環境構築・スキーマ定義

**Step 1（30分）: 環境構築 → Step 2（1時間）: スキーマ定義・検証**

### Step 1: 環境構築

```bash
python -m venv .venv && source .venv/bin/activate
pip install pydantic jsonschema check-jsonschema

# VSCode拡張
code --install-extension redhat.vscode-yaml
code --install-extension ms-python.python

# ディレクトリ構成
mkdir -p schemas/{inspection_result,device_config}
mkdir -p src/validators tests/fixtures
```

### Step 2: スキーマ保存・CLI検証

```bash
# schemas/inspection_result/v1.0.0.schema.json に保存後

# 正常サンプルで検証（→ OK）
check-jsonschema \
  --schemafile schemas/inspection_result/v1.0.0.schema.json \
  tests/fixtures/ok_sample.json

# タイポサンプルで検証（→ エラー検出）
check-jsonschema \
  --schemafile schemas/inspection_result/v1.0.0.schema.json \
  tests/fixtures/ng_typo.json
```

---

## PoC手順書 Step 3〜4：Pydantic実装・テスト

**Step 3（2時間）: Pydanticモデル → Step 4（2時間）: pytestテスト**

### Step 3: Pydanticモデル（src/validators/inspection_result.py）

```python
from pydantic import BaseModel, Field, model_validator
from typing import Literal, Optional
from datetime import datetime

class InspectionResult(BaseModel):
    model_config = {"extra": "forbid"}  # 未定義フィールド禁止
    schema_version: Literal["1.0.0"]
    timestamp:      datetime
    device_id:      str = Field(pattern=r"^[A-Z]{3}-[0-9]{4}$")
    result:         Literal["OK", "NG", "UNKNOWN"]
    confidence:     float = Field(ge=0.0, le=1.0)
    ng_categories:  Optional[list[str]] = None

    @model_validator(mode="after")
    def ng_requires_categories(self):
        if self.result == "NG" and not self.ng_categories:
            raise ValueError("NG判定には ng_categories が必須")
        return self
```

### Step 4: pytestによるバリデーションテスト

```python
import pytest
from src.validators.inspection_result import InspectionResult

VALID = {
    "schema_version": "1.0.0",
    "timestamp":  "2026-01-15T10:30:00Z",
    "device_id":  "CAM-0001",
    "result":     "OK",
    "confidence": 0.98,
}

def test_valid():
    assert InspectionResult(**VALID)

def test_ng_no_categories():   # NG判定でng_categoriesなし
    with pytest.raises(Exception):
        InspectionResult(**{**VALID, "result": "NG"})

def test_typo_field():         # 未定義フィールド
    with pytest.raises(Exception):
        InspectionResult(**{**VALID, "Confidence": 0.5})

def test_confidence_range():   # 信頼度1.0超
    with pytest.raises(Exception):
        InspectionResult(**{**VALID, "confidence": 1.5})
```

---

## PoC手順書 Step 5〜6：VSCode連携・Git管理

**Step 5（30分）: スキーマ補完設定 → Step 6（30分）: Gitバージョン管理**

### Step 5: VSCode補完設定（.vscode/settings.json）

```json
{
  "json.schemas": [
    {
      "fileMatch": ["**/inspection_result/*.json"],
      "url": "./schemas/inspection_result/v1.0.0.schema.json"
    }
  ],
  "yaml.schemas": {
    "./schemas/device_config/v1.0.0.schema.json":
      "**/device_config/*.yaml"
  }
}
```

### Step 6: Gitでスキーマをバージョン管理

```bash
# 初版コミット＋タグ（タグ後はファイル変更禁止）
git add schemas/inspection_result/v1.0.0.schema.json
git commit -m "feat(schema): 検査結果スキーマ v1.0.0 初版"
git tag schema/inspection_result/v1.0.0

# 破壊的変更が必要な場合 → 新ファイルを作成（旧版は残す）
cp schemas/inspection_result/v1.0.0.schema.json \
   schemas/inspection_result/v2.0.0.schema.json
# v2.0.0.schema.json を編集
```

**PRチェックリスト（スキーマ変更時）**
- [ ] 非破壊的変更か / 破壊的変更か を明記
- [ ] 既存データでのバリデーションテストを実施・合格
- [ ] CHANGELOG.md を更新
- [ ] schema_version の const 値をファイル名と一致させた

---

## 動作確認：スクリプトと期待出力

### 合否判定スクリプト（scripts/validate_batch.py）

```python
#!/usr/bin/env python3
import json, sys
from pathlib import Path
from src.validators.inspection_result import InspectionResult
from pydantic import ValidationError

def validate_file(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        InspectionResult(**data)
        return {"file": str(path), "status": "OK"}
    except (ValidationError, json.JSONDecodeError) as e:
        return {"file": str(path), "status": "NG",
                "error": str(e)[:80]}

if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data")
    results = [validate_file(p) for p in sorted(target.glob("*.json"))]
    ok = sum(1 for r in results if r["status"] == "OK")
    ng = sum(1 for r in results if r["status"] == "NG")
    print(f"結果: OK={ok}  NG={ng}  合計={ok+ng}")
    for r in results:
        mark = "✓" if r["status"] == "OK" else "✗"
        err  = f"  → {r['error']}" if "error" in r else ""
        print(f"  {mark} {r['file']}{err}")
    sys.exit(0 if ng == 0 else 1)
```

### 実行方法と期待出力

```bash
python scripts/validate_batch.py data/samples/

# 期待出力
結果: OK=3  NG=2  合計=5
  ✓ data/samples/result_001.json
  ✓ data/samples/result_002.json
  ✗ data/samples/result_003.json
      → ng_categories: Field required
  ✓ data/samples/result_004.json
  ✗ data/samples/result_005.json
      → confidence: Input should be <= 1.0
```

---

## 実施体制・工数・スケジュール

### 実施体制

| 役割 | 担当 | 主な作業 |
|------|------|---------|
| 主担当 | 新人1名 | スキーマ設計・実装・テスト |
| レビュー | ベテラン1名 | 週1レビュー（1h/週） |
| ユーザー | 各テーマ担当 | スキーマ要件の提供 |

### フェーズ別工数

| フェーズ | 期間 | 工数 | マイルストーン |
|---------|------|------|--------------|
| PoC（Step1〜6） | 1週目 | 8h | スキーマ3種・テスト完成 |
| 社内レビュー | 2週目 | 4h | 指摘対応完了 |
| 試行導入 | 3〜4週目 | 8h | 実データ100件バリデーション |
| ガイド整備 | 5〜6週目 | 8h | 運用ガイド・テンプレート完成 |
| 他テーマ展開 | 2〜3ヶ月目 | 随時 | No.7/16 への適用 |

---

## 討論ポイント①②：スキーマ設計・互換性管理

### 討論①：スキーマの粒度

| 論点 | 選択肢A | 選択肢B |
|------|---------|---------|
| 検査結果の網羅性 | 必須フィールドのみ（軽量） | 全フィールド定義（厳格） |
| 装置ごとの差異 | 共通スキーマ1つ | 装置別サブスキーマ |
| 画像パスの持ち方 | JSON内に文字列で持つ | 別ファイル参照（URI） |
| 信頼度の単位 | 0.0〜1.0 | 0〜100（%） |

**議題**：「検査結果」の必須フィールドとして最低限何が必要か？

### 討論②：破壊的変更の管理ルール

| 変更の種類 | バージョン対応 | 備考 |
|-----------|-------------|------|
| フィールド追加（任意） | マイナーアップ | 後方互換あり |
| フィールド削除・改名 | メジャーアップ | 既存データ破損 |
| 型変更 | メジャーアップ | 既存パーサー破損 |
| enum値追加 | マイナーアップ | 既存バリデーター通過 |

**議題**：旧バージョンを何世代まで保持するか？移行期間のルールは？

---

## 討論ポイント③・失敗パターン・波及効果

### 討論③：よくある失敗パターンと対策

| 失敗パターン | 対策 |
|------------|------|
| スキーマなしで先に実装 → 後で統一不能 | **このプロジェクトを最初に実施する理由** |
| フィールド名の表記ゆれ（camel/snake混在） | スキーマで命名規則を強制 |
| バリデーションなしで本番投入 → サイレント不正データ | CI/CDに組み込む（No.9） |
| スキーマ変更時に既存データが壊れる | バージョン管理 + 移行スクリプト |
| チームがスキーマを知らず独自形式で実装 | README + VSCode自動補完 |

**議題**：現場で実際に起きている「データ形式の不統一」の具体例は？

### 他テーマへの波及効果

| 波及先 | 効果 |
|--------|------|
| No.2 社内LLM（RAG） | 入力文書を定型化 → RAG精度向上 |
| No.9 CI/CD基盤 | スキーマバリデーションをCIに組込み |
| No.13 データ版管理 | スキーマ版とデータ版を対応付け |
| No.16 レシピ管理 | 装置設定スキーマを直接活用 |

---

## 参考文献・実施判断基準

### 参考文献

| 種別 | リンク |
|------|-------|
| 公式仕様 | json-schema.org/draft/2020-12/schema |
| Pydantic v2 | docs.pydantic.dev/latest/ |
| CLIバリデーター | check-jsonschema.readthedocs.io |
| バージョン管理 | semver.org/lang/ja/ |
| VSCode連携 | code.visualstudio.com/docs/languages/json |

### 実施判断基準（各メンバー向け）

| 観点 | 内容 |
|------|------|
| やれるか | Step1〜6はPython基礎があれば新人でも可。所要6〜8時間。 |
| やりたいか | 地味だが後続テーマ全体の土台。影響範囲が最大のプロジェクト。 |
| 今やるべきか | 他テーマより先に実施しないと後続が全て場当たり対応になる。 |
| リスク | 低。失敗しても「スキーマ定義がなかった状態」に戻るだけ。 |
