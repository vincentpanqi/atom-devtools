<template>
  <div>
    <split-pane>
      <component-tree slot="left" :instances="instances"></component-tree>
      <component-inspector slot="right" :target="inspectedInstance"></component-inspector>
    </split-pane>
  </div>
</template>

<script>
import SplitPane from 'components/SplitPane.vue'
import ComponentTree from './ComponentTree.vue'
import ComponentInspector from './ComponentInspector.vue'

import { mapState } from 'vuex'

export default {
  components: {
    ComponentTree,
    ComponentInspector,
    SplitPane
  },
  computed: mapState('components', {
    instances: state => state.instances,
    inspectedInstance: state => state.inspectedInstance
  }),
  methods: {
    filter (e) {
      bridge.send('filter-instances', e.target.value)
    }
},
mounted() {
    console.log('instances_____________');
    console.log(this.instances);
    console.log(this.inspectedInstance);
}
}
</script>
