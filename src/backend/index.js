// This is the backend that is injected into the page that a Vue app lives in
// when the Vue Devtools panel is activated.

import { highlight, nodeHighlight, unHighlight, unImgHighlight, getInstanceRect } from './highlighter'
import { initVuexBackend } from './vuex'
import { initEventsBackend } from './events'
import { stringify, classify, camelize } from '../util'
import path from 'path'

// Use a custom basename functions instead of the shimed version
// because it doesn't work on Windows
function basename (filename, ext) {
  return path.basename(
    filename.replace(/^[a-zA-Z]:/, '').replace(/\\/g, '/'),
    ext
  )
}

// hook should have been injected before this executes.
const hook = window.__VUE_DEVTOOLS_GLOBAL_HOOK__
const rootInstances = []
const imgSrcError = []; // 存放src不是https的img 借点
const propModes = ['default', 'sync', 'once']

const instanceMap = window.__VUE_DEVTOOLS_INSTANCE_MAP__ = new Map()

const consoleBoundInstances = Array(5)
let currentInspectedId
let bridge
let filter = ''
let captureCount = 0
let isLegacy = false
let rootUID = 0;
let vueInstanceInfo = {};
let vueInstanceInfoOrigin = {};
let vueInstanceArrOrigin = [];
let vueInstanceInfoUpdated = {};
let vueInstanceArrUpdated = [];
let imgHttpMap = new Map();
let imgHttpMapIndex = 0;

export function initBackend (_bridge) {

  bridge = _bridge
  if (hook.Vue) {
    isLegacy = hook.Vue.version && hook.Vue.version.split('.')[0] === '1'
    connect()
  } else {
    hook.once('init', connect)
  }
}

function connect () {
  hook.currentTab = 'components';
  bridge.on('switch-tab', tab => {
    hook.currentTab = tab
    if (tab === 'components') {
      flush()
    }
  })

  // the backend may get injected to the same page multiple times
  // if the user closes and reopens the devtools.
  // make sure there's only one flush listener.
  hook.off('flush')
  hook.on('flush', () => {
    // if (hook.currentTab === 'components') { // 去掉 在 componenttab下触发的限制
      flush()
    // }
  })

  hook.on('refresh', () => {
      console.log('page onload');
      scan();

  })

  bridge.on('select-instance', id => {
    currentInspectedId = id
    const instance = instanceMap.get(id)
    if (instance) {
      scrollIntoView(instance)
      highlight(instance)
    }
    bindToConsole(instance)
    flush()
    bridge.send('instance-details', stringify(getInstanceDetails(id)))
  })

  bridge.on('filter-instances', _filter => {
    filter = _filter.toLowerCase()
    flush()
  })

  bridge.on('refresh', scan)
  bridge.on('enter-instance', id => highlight(instanceMap.get(id)))
  bridge.on('leave-instance', unHighlight)

  bridge.on('viewBeforeUpdate', () => {
      // console.log('viewBeforeUpdate*******************************************');
      // console.log(getVueInstance(document));
      // console.log(vueInstanceInfoOrigin);

  });
  bridge.on('viewUpdated', () => {
      console.log('viewUpdated*******************************************');
      // vueInstanceInfoUpdated = getVueInstance(document);
      // console.log(vueInstanceInfoOrigin);
      // console.log(vueInstanceInfoUpdated);
  });

    bridge.on('enter-img-node', index => nodeHighlight(imgHttpMap.get(`imgNode${index}`)));
    bridge.on('leave-img-node', unImgHighlight)
  // vuex
  if (hook.store) {
    initVuexBackend(hook, bridge)
  } else {
    hook.once('vuex:init', store => {
      initVuexBackend(hook, bridge)
    })
  }

  // events
initEventsBackend(hook.Vue, bridge)
  bridge.log('backend ready.')
  bridge.send('ready', hook.Vue.version)
  console.log(
    `%c atom-devtools %c Detected Atom v${hook.Vue.version} %c`,
    'background:#35495e ; padding: 1px; border-radius: 3px 0 0 3px;  color: #fff',
    'background:#41b883 ; padding: 1px; border-radius: 0 3px 3px 0;  color: #fff',
    'background:transparent'
  )
  scan()
}

/**
 * Scan the page for root level Vue instances.
 */

function scan() {
    rootInstances.length = 0;
    let inFragment = false;
    let currentFragment = null;
    imgSrcError.length = 0; // refresh时清空数组
    imgHttpMapIndex = 0;
    imgHttpMap = new Map();
    checkSrc(document);
    // vueInstanceInfoOrigin = getVueInstance(document);
    walk(document, function (node) {
        if (inFragment) {
            if (node === currentFragment._fragmentEnd) {
                inFragment = false;
                currentFragment = null;
            }
            return true;
        }

        const instance = node.__vue__;
        if (instance) { // 当前demo都没有 _isFragment该属性
            if (instance._isFragment) {
                inFragment = true;
                currentFragment = instance;
            }
            console.log(node.childNodes)
            // respect Vue.config.devtools option
            let baseVue = instance.constructor;
            while (baseVue.super) {
                baseVue = baseVue.super;
            }

            if (baseVue.config && baseVue.config.devtools) {
                // give a unique id to root instance so we can
                // 'namespace' its children
                if (typeof instance.__VUE_DEVTOOLS_ROOT_UID__ === 'undefined') {
                    instance.__VUE_DEVTOOLS_ROOT_UID__ = ++rootUID;
                }
                rootInstances.push(instance);
            }

            return true;
        }
    });
    flush();
}

/**
 * DOM walk helper
 *
 * @param {NodeList} nodes
 * @param {Function} fn
 */

function walk(node, fn) {
    if (node.childNodes) {
        for (let i = 0, l = node.childNodes.length; i < l; i++) {
            const child = node.childNodes[i];
            const stop = fn(child);
            if (!stop) {
                walk(child, fn);
            }
        }
    }

    // also walk shadow DOM
    if (node.shadowRoot) {
        walk(node.shadowRoot, fn);
    }
}

// 检查相同组件的情况
function checkInstanceName(arr, name) {
    let copy = arr;
    let num = 0;
    for (let i = 0; i < copy.length; i++) {
        copy[i] = copy[i].replace(/-\d$/, '');
    }
    for (let i = 0; i < copy.length; i++) {
        if (copy[i] === name) {
            num++;
        }
    }
    return num;
}
var cloneObj = function(obj){
    var str, newobj = obj.constructor === Array ? [] : {};
    if(typeof obj !== 'object'){
        return;
    }
    else {
        for(var i in obj){
            if (obj.hasOwnProperty(i) && !(i instanceof Function) && (i !== '__ob__')) {
                newobj[i] = typeof obj[i] === 'object' ?
                cloneObj(obj[i]) : obj[i];
            }
        }
    }
    return newobj;
};


function getInstanceData(instance) {
    let props = instance.$options.$props;
    // const getters =
    //   instance.$options.vuex &&
    //   instance.$options.vuex.getters;
    // let data = Object.keys(instance._data)
    //   .filter(key => (
    //     !(props && key in props) &&
    //     !(getters && key in getters)
    //   ))
    //   .map(key => ({
    //     key,
    //     value: instance._data[key]
    //   }));

    return {
        props,
        data: instance.$data
    };
}
// 获取当前dom里的vue实例
function getVueInstance(node) {
    let output = {};
    if (node.childNodes) {

        for (let i = 0, l = node.childNodes.length; i < l; i++) {
            const child = node.childNodes[i];
            const instance = child.__vue__;
            if (instance) {
                let instanceName = getInstanceName(instance);
                let instanceData = getInstanceData(instance);
                let value = {};
                if (output[instanceName]) {
                    // vueInstanceInfo[instanceName + '-' + checkInstanceName(vueInstanceArrOrigin, instanceName)]
                    //     = instanceData;
                    value[instanceName + '-' + checkInstanceName(vueInstanceArrOrigin, instanceName)] = instanceData;
                }
                else {
                    vueInstanceArrOrigin.push(instanceName);
                    value[instanceName] = instanceData;
                }
                Object.assign(output, value);

            }
            Object.assign(output, getVueInstance(child));
        }
    }

    return Object.assign({}, output);
}

/**
 * 检查img node的src是否为https
 *
 * @param {Node} node 节点
 * @return
 */
function checkSrc(node) {
    if (window.location.href.toLowerCase().indexOf('https') > 0) {
        if (node.childNodes) {

            for (let i = 0, l = node.childNodes.length; i < l; i++) {
                const child = node.childNodes[i];
                if (child.tagName === 'IMG') {

                    if (child.src.indexOf('https') === -1) {
                        // nodeHighlight(child);
                        imgHttpMap.set(`imgNode${imgHttpMapIndex}`, child);
                        imgSrcError.push({
                            html: child.outerHTML,
                            index: imgHttpMapIndex
                        });
                        imgHttpMapIndex++;
                    }
                }
                checkSrc(child);
            }
        }

        return false;
    }

}

/**
 * Called on every Vue.js batcher flush cycle.
 * Capture current component tree structure and the state
 * of the current inspected instance (if present) and
 * send it to the devtools.
 */

function flush () {
  let start
  if (process.env.NODE_ENV !== 'production') {
    captureCount = 0;
    start = window.performance.now()
  }
  const payload = stringify({
    inspectedInstance: getInstanceDetails(currentInspectedId), // select instance to change currentInspectedId
    instances: findQualifiedChildrenFromList(rootInstances),
    imgHTTP: imgSrcError
});

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[flush] serialized ${captureCount} instances, took ${window.performance.now() - start}ms.`)
  }
  bridge.send('flush', payload)
}

/**
 * Iterate through an array of instances and flatten it into
 * an array of qualified instances. This is a depth-first
 * traversal - e.g. if an instance is not matched, we will
 * recursively go deeper until a qualified child is found.
 *
 * @param {Array} instances
 * @return {Array}
 */

function findQualifiedChildrenFromList (instances) {
  instances = instances
    .filter(child => !child._isBeingDestroyed)
  return !filter
    ? instances.map(capture)
    : Array.prototype.concat.apply([], instances.map(findQualifiedChildren))
}

/**
 * Find qualified children from a single instance.
 * If the instance itself is qualified, just return itself.
 * This is ok because [].concat works in both cases.
 *
 * @param {Vue} instance
 * @return {Vue|Array}
 */

function findQualifiedChildren (instance) {
  return isQualified(instance)
    ? capture(instance)
    : findQualifiedChildrenFromList(instance.$children)
}

/**
 * Check if an instance is qualified.
 *
 * @param {Vue} instance
 * @return {Boolean}
 */

function isQualified (instance) {
  const name = getInstanceName(instance).toLowerCase()
  return name.indexOf(filter) > -1
}

/**
 * Capture the meta information of an instance. (recursive)
 *
 * @param {Vue} instance
 * @return {Object}
 */

function capture (instance, _, list) {
  if (process.env.NODE_ENV !== 'production') {
    captureCount++
  }
  // instance._uid is not reliable in devtools as there
  // may be 2 roots with same _uid which causes unexpected
  // behaviour
  instance.__VUE_DEVTOOLS_UID__ = getUniqueId(instance)
  mark(instance)
  const ret = {
    id: instance.__VUE_DEVTOOLS_UID__,
    name: getInstanceName(instance),
    inactive: !!instance._inactive,
    isFragment: !!instance._isFragment,
    children: instance.$children
      .filter(child => !child._isBeingDestroyed)
      .map(capture)
  }
  // record screen position to ensure correct ordering
  if ((!list || list.length > 1) && !instance._inactive) {
    const rect = getInstanceRect(instance)
    ret.top = rect ? rect.top : Infinity
  } else {
    ret.top = Infinity
  }
  // check if instance is available in console
  const consoleId = consoleBoundInstances.indexOf(instance.__VUE_DEVTOOLS_UID__)
  ret.consoleId = consoleId > -1 ? '$vm' + consoleId : null
  // check router view
  const isRouterView2 = instance.$vnode && instance.$vnode.data.routerView
  if (instance._routerView || isRouterView2) {
    ret.isRouterView = true
    if (!instance._inactive && instance.$route) {
      const matched = instance.$route.matched
      const depth = isRouterView2
        ? instance.$vnode.data.routerViewDepth
        : instance._routerView.depth
      ret.matchedRouteSegment =
        matched &&
        matched[depth] &&
        (isRouterView2 ? matched[depth].path : matched[depth].handler.path)
    }
  }
  return ret
}

/**
 * Mark an instance as captured and store it in the instance map.
 *
 * @param {Vue} instance
 */

function mark (instance) {
  if (!instanceMap.has(instance.__VUE_DEVTOOLS_UID__)) {
    instanceMap.set(instance.__VUE_DEVTOOLS_UID__, instance)
    instance.$on('hook:beforeDestroy', function () {
      instanceMap.delete(instance.__VUE_DEVTOOLS_UID__)
    })
  }
}

/**
 * Get the detailed information of an inspected instance.
 *
 * @param {Number} id
 */

function getInstanceDetails (id) {
  const instance = instanceMap.get(id)
  if (!instance) {
    return {}
  } else {
    return {
      id: id,
      name: getInstanceName(instance),
      state: processProps(instance).concat(
        processState(instance),
        processComputed(instance),
        processRouteContext(instance),
        processVuexGetters(instance),
        processFirebaseBindings(instance),
        processObservables(instance)
      )
    }
  }
}

/**
 * Get the appropriate display name for an instance.
 *
 * @param {Vue} instance
 * @return {String}
 */

export function getInstanceName (instance) {
  const name = instance.$options.name || instance.$options._componentTag
  if (name) {
    return classify(name)
  }
  const file = instance.$options.__file // injected by vue-loader
  if (file) {
    return classify(basename(file, '.vue'))
  }
  return instance.$root === instance
    ? 'Root'
    : 'Anonymous Component'
}

/**
 * Process the props of an instance.
 * Make sure return a plain object because window.postMessage()
 * will throw an Error if the passed object contains Functions.
 *
 * @param {Vue} instance
 * @return {Array}
 */

function processProps (instance) {
  let props
  if (isLegacy && (props = instance._props)) {
    // 1.x
    return Object.keys(props).map(key => {
      const prop = props[key]
      const options = prop.options
      return {
        type: 'props',
        key: prop.path,
        value: instance[prop.path],
        meta: {
          type: options.type ? getPropType(options.type) : 'any',
          required: !!options.required,
          mode: propModes[prop.mode]
        }
      }
    })
  } else if ((props = instance.$options.props)) {
    // 2.0
    const propsData = []
    for (let key in props) {
      const prop = props[key]
      key = camelize(key)
      propsData.push({
        type: 'props',
        key,
        value: instance[key],
        meta: {
          type: prop.type ? getPropType(prop.type) : 'any',
          required: !!prop.required
        }
      })
    }
    return propsData
  } else {
    return []
  }
}

/**
 * Convert prop type constructor to string.
 *
 * @param {Function} fn
 */

const fnTypeRE = /^(?:function|class) (\w+)/
function getPropType (type) {
  const match = type.toString().match(fnTypeRE)
  return typeof type === 'function'
    ? match && match[1] || 'any'
    : 'any'
}

/**
 * Process state, filtering out props and "clean" the result
 * with a JSON dance. This removes functions which can cause
 * errors during structured clone used by window.postMessage.
 *
 * @param {Vue} instance
 * @return {Array}
 */

function processState (instance) {
  const props = isLegacy
    ? instance._props
    : instance.$options.props
  const getters =
    instance.$options.vuex &&
    instance.$options.vuex.getters
  return Object.keys(instance._data)
    .filter(key => (
      !(props && key in props) &&
      !(getters && key in getters)
    ))
    .map(key => ({
      key,
      value: instance._data[key]
    }))
}

/**
 * Process the computed properties of an instance.
 *
 * @param {Vue} instance
 * @return {Array}
 */

function processComputed (instance) {
  const computed = []
  const defs = instance.$options.computed || {}
  // use for...in here because if 'computed' is not defined
  // on component, computed properties will be placed in prototype
  // and Object.keys does not include
  // properties from object's prototype

  for (const key in defs) {
    const def = defs[key]
    const type = typeof def === 'function' && def.vuex
      ? 'vuex bindings'
      : 'computed'
    // use try ... catch here because some computed properties may
    // throw error during its evaluation
    let computedProp = null
    try {
      computedProp = {
        type,
        key,
        value: instance[key]
      }
    } catch (e) {
      computedProp = {
        type,
        key,
        value: '(error during evaluation)'
      }
    }

    computed.push(computedProp)
  }

  return computed
}

/**
 * Process possible vue-router $route context
 *
 * @param {Vue} instance
 * @return {Array}
 */

function processRouteContext (instance) {
  const route = instance.$route
  if (route) {
    const { path, query, params } = route
    const value = { path, query, params }
    if (route.fullPath) value.fullPath = route.fullPath
    if (route.hash) value.hash = route.hash
    if (route.name) value.name = route.name
    if (route.meta) value.meta = route.meta
    return [{
      key: '$route',
      value
    }]
  } else {
    return []
  }
}

/**
 * Process Vuex getters.
 *
 * @param {Vue} instance
 * @return {Array}
 */

function processVuexGetters (instance) {
  const getters =
    instance.$options.vuex &&
    instance.$options.vuex.getters
  if (getters) {
    return Object.keys(getters).map(key => {
      return {
        type: 'vuex getters',
        key,
        value: instance[key]
      }
    })
  } else {
    return []
  }
}

/**
 * Process Firebase bindings.
 *
 * @param {Vue} instance
 * @return {Array}
 */

function processFirebaseBindings (instance) {
  var refs = instance.$firebaseRefs
  if (refs) {
    return Object.keys(refs).map(key => {
      return {
        type: 'firebase bindings',
        key,
        value: instance[key]
      }
    })
  } else {
    return []
  }
}

/**
 * Process vue-rx observable bindings.
 *
 * @param {Vue} instance
 * @return {Array}
 */

function processObservables (instance) {
  var obs = instance.$observables
  if (obs) {
    return Object.keys(obs).map(key => {
      return {
        type: 'observables',
        key,
        value: instance[key]
      }
    })
  } else {
    return []
  }
}

/**
 * Sroll a node into view.
 *
 * @param {Vue} instance
 */

function scrollIntoView (instance) {
  const rect = getInstanceRect(instance)
  if (rect) {
    window.scrollBy(0, rect.top)
  }
}

/**
 * Binds given instance in console as $vm0.
 * For compatibility reasons it also binds it as $vm.
 *
 * @param {Vue} instance
 */

function bindToConsole (instance) {
  const id = instance.__VUE_DEVTOOLS_UID__
  const index = consoleBoundInstances.indexOf(id)
  if (index > -1) {
    consoleBoundInstances.splice(index, 1)
  } else {
    consoleBoundInstances.pop()
  }
  consoleBoundInstances.unshift(id)
  for (var i = 0; i < 5; i++) {
    window['$vm' + i] = instanceMap.get(consoleBoundInstances[i])
  }
  window.$vm = instance
}

/**
 * Returns a devtools unique id for instance.
 * @param {Vue} instance
 */
function getUniqueId (instance) {
  const rootVueId = instance.$root.__VUE_DEVTOOLS_ROOT_UID__
  return `${rootVueId}:${instance._uid}`
}
