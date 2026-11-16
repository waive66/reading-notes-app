import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import {
  PROVIDERS, PROVIDER_ORDER, getProvider, costLabel, isFreeModel,
  testConnection, listModels, needsPaidAck
} from '../ai/providers'
import {
  loadConfig, saveConfig, providerConfig, loadKey, saveKey, clearKey,
  maskKey, keyStorageInfo, isPaidAcked, setPaidAck, hasSecureStore
} from '../ai/aiConfig'

export default function Settings() {
  var navigate = useNavigate()
  var logout = useAuth().logout

  var [cfg, setCfg] = useState(loadConfig())
  var [pid, setPid] = useState(loadConfig().active)
  var [form, setForm] = useState({})
  var [apiKey, setApiKey] = useState('')
  var [showKey, setShowKey] = useState(false)
  var [savedKeyMask, setSavedKeyMask] = useState('')
  var [testing, setTesting] = useState(false)
  var [testResult, setTestResult] = useState(null)
  var [models, setModels] = useState([])
  var [loadingModels, setLoadingModels] = useState(false)
  var [toast, setToast] = useState('')
  var [ack, setAck] = useState(false)

  var p = getProvider(pid)
  var storage = keyStorageInfo()

  useEffect(function () {
    var c = loadConfig()
    var pc = providerConfig(pid)
    setForm({ baseUrl: pc.baseUrl || p.baseUrl, model: pc.model || '' })
    var k = loadKey(pid)
    setSavedKeyMask(k ? maskKey(k) : '')
    setApiKey('')
    setShowKey(false)
    setTestResult(null)
    setModels([])
    setAck(isPaidAcked(pid, pc.model))
  }, [pid])

  useEffect(function () {
    setAck(isPaidAcked(pid, form.model))
  }, [form.model])

  function flash(msg) {
    setToast(msg)
    setTimeout(function () { setToast('') }, 2600)
  }

  function pickProvider(id) {
    setPid(id)
    var c = saveConfig({ active: id })
    setCfg(c)
  }

  function setField(k, v) {
    setForm(function (prev) { var n = Object.assign({}, prev); n[k] = v; return n })
  }

  function currentKey() {
    return apiKey || loadKey(pid)
  }

  async function doTest() {
    setTesting(true)
    setTestResult(null)
    var res = await testConnection({
      provider: pid,
      baseUrl: form.baseUrl,
      apiKey: currentKey(),
      model: form.model,
      timeoutMs: 20000
    })
    setTestResult(res)
    setTesting(false)
  }

  async function doListModels() {
    setLoadingModels(true)
    var res = await listModels({ provider: pid, baseUrl: form.baseUrl, apiKey: currentKey() })
    setLoadingModels(false)
    if (res.ok) {
      setModels(res.models)
      if (!form.model && res.models.length) setField('model', res.models[0])
      flash('已拉取 ' + res.models.length + ' 个模型')
    } else {
      setTestResult({ ok: false, error: res.error })
    }
  }

  function doSave() {
    if (!testResult || !testResult.ok) {
      flash('请先测试连接成功，再保存为当前服务')
      return
    }
    if (needsPaidAck(pid, form.model) && !ack) {
      flash('该模型可能产生费用，请先勾选确认')
      return
    }
    if (apiKey) saveKey(pid, apiKey)
    var next = saveConfig({
      active: pid,
      providers: Object.assign({}, cfg.providers, {
        [pid]: { baseUrl: form.baseUrl, model: form.model }
      })
    })
    setCfg(next)
    setSavedKeyMask(loadKey(pid) ? maskKey(loadKey(pid)) : '')
    setApiKey('')
    flash('已保存并设为当前服务')
  }

  function doReset() {
    var def = { baseUrl: p.baseUrl, model: p.defaultModel }
    saveConfig({ providers: Object.assign({}, cfg.providers, { [pid]: def }) })
    setForm(def)
    clearKey(pid)
    setSavedKeyMask('')
    setApiKey('')
    setTestResult(null)
    flash('已恢复默认配置（并清除该服务商的密钥）')
  }

  function toggleAck(val) {
    setAck(val)
    setPaidAck(pid, form.model, val)
  }

  var cost = costLabel(pid, form.model)
  var activeCfg = providerConfig(cfg.active)
  var activeP = getProvider(cfg.active)

  return (
    <div className="settings-page">
      <div className="detail-topbar">
        <button className="icon-btn" onClick={function () { navigate('/') }}>←</button>
        <div className="settings-title">设置</div>
        <div style={{ width: 38 }}></div>
      </div>

      {/* 当前状态 */}
      <section className="card-block">
        <div className="block-head">
          <span className="block-title">当前 AI 服务</span>
          <span className={'pill ' + (cfg.mode === 'proxy' ? 'pill-blue' : 'pill-warm')}>
            {cfg.mode === 'proxy' ? '后端代理' : '自带密钥'}
          </span>
        </div>
        <div className="kv-row"><span>服务商</span><b>{activeP.name}</b></div>
        <div className="kv-row"><span>模型</span><b className="mono">{activeCfg.model || '未选择'}</b></div>
        <div className="kv-row">
          <span>费用属性</span>
          <b className={isFreeModel(activeP.id, activeCfg.model) ? 'ok' : 'warn'}>
            {costLabel(activeP.id, activeCfg.model).text}
          </b>
        </div>
        <div className="kv-row">
          <span>调用方式</span>
          <b>{cfg.mode === 'proxy' ? (cfg.proxyBase || '未填写代理地址') : (loadKey(activeP.id) ? '直连 · 密钥已保存' : '直连 · 未填密钥')}</b>
        </div>
      </section>

      {/* 调用方式 */}
      <section className="card-block">
        <div className="block-head"><span className="block-title">调用方式</span></div>
        <div className="mode-cards">
          <button className={'mode-card' + (cfg.mode === 'proxy' ? ' active' : '')}
            onClick={function () { saveConfig({ mode: 'proxy' }); setCfg(loadConfig()) }}>
            <b>后端代理（推荐）</b>
            <span>密钥只存在你自己的服务器上，APK 里没有任何 Key</span>
          </button>
          <button className={'mode-card' + (cfg.mode === 'byok' ? ' active' : '')}
            onClick={function () { saveConfig({ mode: 'byok' }); setCfg(loadConfig()) }}>
            <b>自带密钥直连</b>
            <span>手机直接请求服务商；密钥存在本机 Keystore</span>
          </button>
        </div>
        {cfg.mode === 'proxy' ? (
          <div className="form-group" style={{ marginTop: 12 }}>
            <label>后端代理地址（例如 http://192.168.1.10:3001）</label>
            <input type="text" defaultValue={cfg.proxyBase} id="proxy-base"
              placeholder="https://你的服务.up.railway.app"
              onBlur={function (e) { saveConfig({ proxyBase: e.target.value.trim() }); setCfg(loadConfig()) }} />
            <label style={{ marginTop: 12 }}>访问口令（与服务端 APP_TOKEN 一致）</label>
            <input type="password" defaultValue={cfg.appToken} placeholder="部署时设置的口令，本地调试可留空"
              onBlur={function (e) { saveConfig({ appToken: e.target.value.trim() }); setCfg(loadConfig()); flash('已保存访问口令') }} />
          </div>
        ) : (
          <div className="note-line">直连模式下，密钥保存在本机（{storage.text}）。仍需注意：客户端密钥存在被逆向提取的风险。</div>
        )}
      </section>

      {/* 服务商 */}
      <section className="card-block">
        <div className="block-head"><span className="block-title">选择服务商</span></div>
        <div className="provider-tabs">
          {PROVIDER_ORDER.map(function (id) {
            var item = PROVIDERS[id]
            return (
              <button key={id} className={'provider-tab' + (pid === id ? ' active' : '')}
                onClick={function () { pickProvider(id) }}>
                {item.name}
              </button>
            )
          })}
        </div>

        <div className="provider-note">{p.note}</div>

        <div className="form-group">
          <label>API Base URL</label>
          <input type="text" value={form.baseUrl || ''} placeholder={p.baseUrl || 'https://example.com/v1'}
            onChange={function (e) { setField('baseUrl', e.target.value) }} />
        </div>

        <div className="form-group">
          <label>模型 ID
            <span className={'cost-tag ' + (cost.free ? 'cost-free' : 'cost-paid')}>{cost.text}</span>
          </label>
          <div className="input-row">
            <input type="text" value={form.model || ''} placeholder={p.defaultModel || '输入模型 ID'}
              onChange={function (e) { setField('model', e.target.value) }} />
            <button className="mini-btn" onClick={doListModels} disabled={loadingModels}>
              {loadingModels ? '…' : '拉取'}
            </button>
          </div>
          {p.models && p.models.length ? (
            <div className="model-chips">
              {p.models.map(function (m) {
                return (
                  <button key={m} className={'model-chip' + (form.model === m ? ' active' : '')}
                    onClick={function () { setField('model', m) }}>{m}</button>
                )
              })}
            </div>
          ) : null}
          {models.length ? (
            <div className="model-chips">
              {models.slice(0, 30).map(function (m) {
                return (
                  <button key={m} className={'model-chip' + (form.model === m ? ' active' : '')}
                    onClick={function () { setField('model', m) }}>{m}</button>
                )
              })}
            </div>
          ) : null}
        </div>

        <div className="form-group">
          <label>API Key
            {savedKeyMask ? <span className="key-saved">已保存：{savedKeyMask}</span> : <span className="key-saved">未保存</span>}
          </label>
          <div className="input-row">
            <input type={showKey ? 'text' : 'password'} value={apiKey}
              placeholder={savedKeyMask ? '如需更换请输入新的 Key（留空则不修改）' : p.keyHint}
              onChange={function (e) { setApiKey(e.target.value) }} />
            <button className="mini-btn" onClick={function () { setShowKey(!showKey) }}>{showKey ? '隐藏' : '显示'}</button>
          </div>
          <div className="key-meta">
            <span>{hasSecureStore() ? '🔒 将使用 Android Keystore 加密保存' : '⚠ 当前环境无 Keystore，仅本次调试有效'}</span>
            {p.keyUrl ? <a href={p.keyUrl} target="_blank" rel="noreferrer">获取 Key ↗</a> : null}
          </div>
        </div>

        {needsPaidAck(pid, form.model) ? (
          <label className="ack-row">
            <input type="checkbox" checked={ack} onChange={function (e) { toggleAck(e.target.checked) }} />
            <span>我已知悉该模型可能产生费用，并同意由我自行承担（应用不会自动切换或自动充值）</span>
          </label>
        ) : null}

        <div className="test-result">
          {testing ? <span className="testing">正在测试连接…</span> : null}
          {testResult && testResult.ok ? (
            <div className="test-ok">
              ✓ 连接成功 · {testResult.latency} ms · 返回「{testResult.sample}」
              {testResult.chinese ? ' · 中文正常' : ' · 未返回中文'}
            </div>
          ) : null}
          {testResult && !testResult.ok ? <div className="test-fail">✗ {testResult.error}</div> : null}
        </div>

        <div className="btn-row">
          <button className="btn btn-secondary" onClick={doTest} disabled={testing}>测试连接</button>
          <button className="btn btn-primary" onClick={doSave}>保存并启用</button>
        </div>
        <button className="link-center" onClick={doReset}>恢复该服务商的默认配置</button>
        <div className="test-hint">测试使用固定文本「请只回复两个字：收到」，不会发送任何日记内容。</div>
      </section>

      {/* 安全说明 */}
      <section className="card-block">
        <div className="block-head"><span className="block-title">密钥与费用</span></div>
        <ul className="sec-list">
          <li>APK 内不含任何开发者密钥；代理模式下密钥只存在服务端环境变量。</li>
          <li>各服务商的密钥分别保存，切换服务商不会串用。</li>
          <li>只有明确标注「免费」的模型才会自动调用；其余模型需在此页手动确认。</li>
          <li>应用不会自动切换模型，也不会自动充值。</li>
        </ul>
        <button className="link-center" onClick={function () { logout(); navigate('/login') }}>退出登录</button>
      </section>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}
