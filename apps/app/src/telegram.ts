import { useEffect, useState } from 'react';
declare global { interface Window { Telegram?: { WebApp?: { ready: () => void; expand: () => void; initData: string; colorScheme?: string } } } }
export function useTelegram() { const [state,setState]=useState({inside:false,initData:''});useEffect(()=>{const app=typeof window!=='undefined'?window.Telegram?.WebApp:undefined;if(app){app.ready();app.expand();setState({inside:true,initData:app.initData});}},[]);return state; }
