import React from 'react';
import { Composition } from 'remotion';
import { defaultPayload } from '../lib/chartTypes';
import { FinanceChart } from './components/FinanceChart';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="FinanceChart"
      component={FinanceChart}
      durationInFrames={150}
      fps={30}
      width={1280}
      height={720}
      defaultProps={defaultPayload}
    />
  );
};
