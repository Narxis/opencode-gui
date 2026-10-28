import { mount } from 'svelte'
import './app.css'
import { apply } from './theme'
apply()
import App from './App.svelte'

mount(App, { target: document.getElementById('app')! })
